/*
 * grunt-wordpress
 * https://github.com/scottgonzalez/grunt-wordpress
 *
 * Copyright (c) 2012 Scott González
 * Licensed under the MIT license.
 */

module.exports = function(grunt) {

var _client,
	fs = require( "fs" ),
	path = require( "path" ),
	wordpress = require( "wordpress" ),
	async = grunt.utils.async;

// Async directory recursion, always walks all files before recursing
function recurse( rootdir, fn, complete ) {
	var path = rootdir + "/*";
	async.mapSeries( grunt.file.expandFiles( path ), fn, function( error ) {
		if ( error ) {
			return complete( error );
		}

		async.map( grunt.file.expandDirs( path ), function( dir, dirComplete ) {
			recurse( dir, fn, dirComplete );
		}, complete );
	});
}

function getClient() {
	if ( !_client ) {
		_client = wordpress.createClient( grunt.config( "wordpress" ) );
	}
	return _client;
}

// Converts a postPath to a more readable name, e.g., "page/foo/bar" to "page foo/bar"
function prettyName( postPath ) {
	return postPath.replace( "/", " " );
}

grunt.registerTask( "wordpress-publish", "Generate posts in WordPress from HTML files", function() {
	var done = this.async();
	async.waterfall([
		function getPostPaths( fn ) {
			// TODO: system.listMethods() to check if gw.getPostPaths exists.
			getClient().call( "gw.getPostPaths", "any", fn );
		},

		function publishPosts( postPaths, fn ) {
			var posts = {};

			grunt.helper( "wordpress-walk", "dist/", function( post, fn ) {
				post.id = postPaths[ post.__postPath ];
				if ( !post.status ) {
					post.status = "publish";
				}
				if ( post.__parent ) {
					post.parent = postPaths[ post.__parent ] || posts[ post.__parent ];
				}

				grunt.helper( "wordpress-publish-post", post, function( error, id ) {
					if ( error ) {
						grunt.log.error( "Error publishing " + prettyName( post.__postPath ) + "." );
						return fn( error );
					}

					grunt.log.writeln( "Published " + prettyName( post.__postPath ).green + "." );
					posts[ post.__postPath ] = id;
					delete postPaths[ post.__postPath ];
					fn( null );
				});
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				fn( null, postPaths );
			});
		},

		function deletePosts( postPaths, fn ) {
			var client = getClient();
			async.map( Object.keys( postPaths ), function( postPath, fn ) {
				client.deletePost( postPaths[ postPath ], function( error ) {
					if ( error ) {
						grunt.log.error( "Error trashing " + prettyName( postPath ) + "." );
						return fn( error );
					}

					// The first delete moves to trash; this one deletes :-)
					client.deletePost( postPaths[ postPath ], function( error ) {
						if ( error ) {
							grunt.log.error( "Error deleting " + prettyName( postPath ) + "." );
							return fn( error );
						}

						grunt.log.writeln( "Deleted " + prettyName( postPath ).red + "." );
						fn( null );
					});
				});
			}, fn );
		}
	], function( error ) {
		if ( !error ) {
			return done();
		}

		if ( error.code === "ECONNREFUSED" ) {
			grunt.log.error( "Could not connect to WordPress XML-RPC server." );
		} else {
			grunt.log.error( error );
		}

		done( false );
	});
});

grunt.registerTask( "wordpress-validate", "Validate HTML files for publishing to WordPress", function() {
	var done = this.async(),
		count = 0;

	grunt.helper( "wordpress-walk", "dist/", function( post, fn ) {
		count++;
		fn( null );
	}, function( error ) {
		if ( error ) {
			grunt.log.error( error );
			return done( false );
		}

		grunt.log.writeln( "Validated " + count + " files." );
		done();
	});
});

grunt.registerHelper( "wordpress-walk", function( dir, walkFn, complete ) {
	recurse( dir, function( file, fn ) {
		var postPath = file.substr( dir.length, file.length - dir.length - 5 ),
			parts = postPath.split( "/" ),
			name = parts.pop(),
			parent = parts.length > 1 ? parts.join( "/" ) : null,
			type = parts.shift(),
			post = grunt.helper( "wordpress-parse-post", file );

		if ( !post ) {
			return fn( new Error( "Invalid post: " + file ) );
		}

		post.type = type;
		post.name = name;
		post.__parent = parent;
		post.__postPath = postPath;

		walkFn( post, fn );
	}, complete );
});

// Parse an html file into a post object. The metadata for the post is read
// out of a <script> element containing JSON at the top of the file.
grunt.registerHelper( "wordpress-parse-post", function( path ) {
	var index,
		post = {},
		content = grunt.file.read( path );

	// The metadata is optional, if it exists it must be the first characater
	if ( content.substring( 0, 8 ) === "<script>" ) {
		try {
			index = content.indexOf( "</script>" );
			post = JSON.parse( content.substr( 8, index - 8 ) );
			content = content.substr( index + 9 );
		} catch( error ) {
			grunt.log.error( "Invalid JSON metadata for " + path );
			return null;
		}
	}

	post.content = content;
	return post;
});

// Publish (create or update) a post to WordPress.
grunt.registerHelper( "wordpress-publish-post", function( post, fn ) {
	var client = getClient();
	if ( post.id ) {
		// Get existing custom fields
		client.getPost( post.id, [ "customFields" ], function( error, postData ) {
			if ( error ) {
				return fn( error );
			}

			// If there are any existing custom fields, then we need to determine
			// what to add, edit, and delete.
			if ( postData.customFields.length ) {
				post.customFields = post.customFields || [];
				post.customFields.forEach(function( customField ) {
					// Look for exact matches
					var index;
					if ( postData.customFields.some(function( existingCustomField, i ) {
						index = i;
						return customField.key === existingCustomField.key &&
							customField.value === existingCustomField.value;
					})) {
						// Copy the id to do an update and remove from the list
						// of existing custom fields
						customField.id = postData.customFields[ index ].id;
						postData.customFields.splice( index, 1 );
					}
				});

				// Delete any existing custom fields that are left over
				post.customFields = post.customFields.concat(
					postData.customFields.map(function( customField ) {
						return { id: customField.id };
					})
				);
			}

			// Update the post
			client.editPost( post.id, post, function( error ) {
				if ( error ) {
					return fn( error );
				}

				fn( null, post.id );
			});
		});
	} else {
		client.newPost( post, fn );
	}
});

grunt.registerTask( "wordpress-deploy", "build wordpress-publish" );

};

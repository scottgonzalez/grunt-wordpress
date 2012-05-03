/*
 * grunt-wordpress
 * https://github.com/scottgonzalez/grunt-wordpress
 *
 * Copyright (c) 2012 Scott González
 * Licensed under the MIT license.
 */

module.exports = function(grunt) {

// TODO: support for static resources (requires new XML-RPC method)

var _client,
	fs = require( "fs" ),
	path = require( "path" ),
	wordpress = require( "wordpress" ),
	taxonomies = require( grunt.task.getFile( "wordpress/taxonomies.js" ) )( grunt ),
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

// Converts a postPath to a more readable name, e.g., "page/foo/bar" to "page foo/bar"
function prettyName( postPath ) {
	return postPath.replace( "/", " " );
}

grunt.registerHelper( "wordpress-client", function() {
	if ( !_client ) {
		_client = wordpress.createClient( grunt.config( "wordpress" ) );
	}
	return _client;
});

// TODO: Smarter updates (compare checksums and only republish if there were changes)
grunt.registerTask( "wordpress-publish", "Generate posts in WordPress from HTML files", function() {
	this.requires( "wordpress-validate" );
	var done = this.async(),
		dir = grunt.config( "wordpress.dir" );
	async.waterfall([
		function processTaxonomies( fn ) {
			var taxonomiesPath = path.join( dir, "taxonomies.json" );
			if ( path.existsSync( taxonomiesPath ) ) {
				taxonomies.process( taxonomiesPath, fn );
			} else {
				fn( null );
			}
		},

		function getPostPaths( fn ) {
			grunt.verbose.write( "Getting post paths from WordPress..." );
			grunt.helper( "wordpress-client" ).call( "gw.getPostPaths", "any", fn );
		},

		function publishPosts( postPaths, fn ) {
			var posts = {};
			grunt.verbose.ok();

			grunt.verbose.writeln();
			grunt.verbose.writeln( "Publishing posts.".bold );
			grunt.helper( "wordpress-walk-posts", dir, function( post, fn ) {
				post.id = postPaths[ post.__postPath ];
				if ( !post.status ) {
					post.status = "publish";
				}
				if ( post.__parent ) {
					post.parent = postPaths[ post.__parent ] || posts[ post.__parent ];
				}

				grunt.helper( "wordpress-publish-post", post, function( error, id ) {
					if ( error ) {
						grunt.verbose.or.error( "Error publishing " + prettyName( post.__postPath ) + "." );
						return fn( error );
					}

					posts[ post.__postPath ] = id;
					delete postPaths[ post.__postPath ];
					fn( null );
				});
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, postPaths );
			});
		},

		function deletePosts( postPaths, fn ) {
			var client = grunt.helper( "wordpress-client" );

			grunt.verbose.writeln( "Deleting old posts.".bold );
			async.map( Object.keys( postPaths ), function( postPath, fn ) {
				var name = prettyName( postPath );
				grunt.verbose.write( "Trashing " + name + "..." );
				client.deletePost( postPaths[ postPath ], function( error ) {
					if ( error ) {
						grunt.verbose.error();
						grunt.verbose.or.error( "Error trashing " + name + "." );
						return fn( error );
					}

					// The first delete moves to trash; this one deletes :-)
					grunt.verbose.ok();
					grunt.verbose.write( "Deleting " + name + "..." );
					client.deletePost( postPaths[ postPath ], function( error ) {
						if ( error ) {
							grunt.verbose.error();
							grunt.verbose.or.error( "Error deleting " + name + "." );
							return fn( error );
						}

						grunt.verbose.ok();
						grunt.verbose.or.writeln( "Deleted " + name + "." );
						fn( null );
					});
				});
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null );
			});
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
		dir = grunt.config( "wordpress.dir" ),
		count = 0;

	// TODO:
	// - Verify that all child posts actually have parents
	//    - All directories must have a matching file
	// - Verify that all files have .html extension
	// - Verify required metadata
	//    - Title, anything else?
	// - Verify gw.getPostPaths exists
	// - Verify that jQuery Slugs plugin exists
	// - Verify taxonomies.js
	//    - Requires name, slug
	//    - Slug must be [a-z0-9.-], no consecutive dashes
	//    - Check for existing terms with same name, but different slug

	grunt.helper( "wordpress-walk-posts", dir, function( post, fn ) {
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

grunt.registerHelper( "wordpress-walk-posts", function( dir, walkFn, complete ) {
	dir = path.join( dir, "posts/" );
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
	var client = grunt.helper( "wordpress-client" ),
		name = prettyName( post.__postPath );

	if ( post.id ) {
		// Get existing custom fields
		grunt.verbose.write( "Getting custom fields for " + name + "..." );
		client.getPost( post.id, [ "customFields" ], function( error, postData ) {
			if ( error ) {
				grunt.verbose.error();
				return fn( error );
			}

			grunt.verbose.ok();
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
			grunt.verbose.write( "Editing " + name + "..." );
			client.editPost( post.id, post, function( error ) {
				if ( error ) {
					grunt.verbose.error();
					return fn( error );
				}

				grunt.verbose.ok();
				grunt.verbose.or.writeln( "Edited " + name + "." );
				fn( null, post.id );
			});
		});
	} else {
		grunt.verbose.write( "Creating " + name + "..." );
		client.newPost( post, function( error, id ) {
			if ( error ) {
				grunt.verbose.error();
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Created " + name + "." );
			fn( null, id );
		});
	}
});

grunt.registerTask( "wordpress-deploy", "build wordpress-validate wordpress-publish" );

};

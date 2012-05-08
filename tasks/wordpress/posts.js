module.exports = function( grunt ) {

var path = require( "path" ),
	async = grunt.utils.async;

// Converts a postPath to a more readable name, e.g., "page/foo/bar" to "page foo/bar"
function prettyName( postPath ) {
	return postPath.replace( "/", " " );
}

grunt.registerHelper( "wordpress-get-postpaths", function( fn ) {
	var client = grunt.helper( "wordpress-client" );
	grunt.verbose.write( "Getting post paths from WordPress..." );
	client.call( "gw.getPostPaths", "any", function( error, postPaths ) {
		if ( error ) {
			grunt.verbose.error();
			return fn( error );
		}

		grunt.verbose.ok();
		grunt.verbose.writeln();
		fn( null, postPaths );
	});
});

grunt.registerHelper( "wordpress-walk-posts", function( dir, walkFn, complete ) {
	grunt.helper( "wordpress-recurse", dir, function( file, fn ) {
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
					grunt.verbose.or.error( "Error editing " + name + "..." );
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
				grunt.verbose.or.error( "Error creating " + name + "..." );
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Created " + name + "." );
			fn( null, id );
		});
	}
});

// TODO: this signature is kinda ghetto
grunt.registerHelper( "wordpress-delete-post", function( postId, postPath, fn ) {
	var client = grunt.helper( "wordpress-client" ),
		name = prettyName( postPath );
	grunt.verbose.write( "Trashing " + name + "..." );
	client.deletePost( postId, function( error ) {
		if ( error ) {
			grunt.verbose.error();
			grunt.verbose.or.error( "Error trashing " + name + "." );
			return fn( error );
		}

		// The first delete moves to trash; this one deletes :-)
		grunt.verbose.ok();
		grunt.verbose.write( "Deleting " + name + "..." );
		client.deletePost( postId, function( error ) {
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
});

grunt.registerHelper( "wordpress-sync-posts", function( path, termMap, fn ) {
	if ( typeof termMap === "function" ) {
		fn = termMap;
		termMap = null;
	}

	async.waterfall([
		function getPostPaths( fn ) {
			grunt.helper( "wordpress-get-postpaths", fn );
		},

		function publishPosts( postPaths, fn ) {
			var posts = {};

			grunt.verbose.writeln( "Publishing posts.".bold );
			grunt.helper( "wordpress-walk-posts", path, function( post, fn ) {
				var name = prettyName( post.__postPath );
				post.id = postPaths[ post.__postPath ];
				if ( !post.status ) {
					post.status = "publish";
				}
				if ( post.__parent ) {
					post.parent = postPaths[ post.__parent ] || posts[ post.__parent ];
				}

				// Convert term slugs to term ids
				if ( post.termSlugs ) {
					post.terms = {};
					Object.keys( post.termSlugs ).forEach(function( taxonomy ) {
						// Check if the taxonomy exists
						if ( !termMap || !termMap[ taxonomy ] ) {
							return fn( new Error(
								name + " has '" + taxonomy + "' term slugs, " +
								"but no such taxonomy exists." ) );
						}

						post.terms[ taxonomy ] = [];
						post.termSlugs[ taxonomy ].forEach(function( slug ) {
							var termId = termMap[ taxonomy ][ slug ];

							// Check if the slug exists
							if ( !termId ) {
								return fn( new Error(
									name + " has a " + taxonomy + " term slug of " +
									"'" + slug + "', but no such term exists." ) );
							}

							post.terms[ taxonomy ].push( termId );
						});
					});
				}

				grunt.helper( "wordpress-publish-post", post, function( error, id ) {
					if ( error ) {
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
			grunt.verbose.writeln( "Deleting old posts.".bold );
			async.map( Object.keys( postPaths ), function( postPath, fn ) {
				grunt.helper( "wordpress-delete-post", postPaths[ postPath ], postPath, fn );
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null );
			});
		}
	], fn );
});

};

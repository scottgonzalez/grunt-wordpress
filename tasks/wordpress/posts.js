module.exports = function( grunt ) {

var path = require( "path" ),
	util = require( "util" ),
	crypto = require( "crypto" ),
	async = grunt.utils.async;

// Converts a postPath to a more readable name, e.g., "page/foo/bar" to "page foo/bar"
function prettyName( postPath ) {
	return postPath.replace( "/", " " );
}

function flatten( obj ) {
	if ( obj == null ) {
		return "";
	}

	if ( typeof obj === "string" ) {
		return obj;
	}

	if ( typeof obj === "number" ) {
		return String( obj );
	}

	if ( util.isDate( obj ) ) {
		return obj.toGMTString();
	}

	if ( util.isArray( obj ) ) {
		return obj.map(function( item ) {
			return flatten( item );
		}).join( "," );
	}

	return Object.keys( obj ).sort().map(function( prop ) {
		return prop + ":" + flatten( obj[ prop ] );
	}).join( ";" );
}

function createChecksum( obj ) {
	var md5 = crypto.createHash( "md5" );
	md5.update( flatten( obj ), "utf8" );
	return md5.digest( "hex" );
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
		post.__file = file;

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
			if ( "date" in post ) {
				post.date = new Date( post.date );
			}
			if ( "modified" in post ) {
				post.modified = new Date( post.modified );
			}
			content = content.substr( index + 9 );
		} catch( error ) {
			grunt.log.error( "Invalid JSON metadata for " + path );
			return null;
		}
	}

	post.content = content;
	return post;
});

grunt.registerHelper( "wordpress-validate-posts", function( dir, fn ) {
	var count = 0,
		postPaths = {};

	grunt.helper( "wordpress-walk-posts", dir, function( post, fn ) {
		// If there's a problem parsing the content of the file, then wordpress-walk-posts
		// will return an error and we'll automatically stop walking. So we know that the
		// content and structure of the metadata is already valid.
		var file = post.__file;

		postPaths[ post.__postPath ] = true;

		// Verify file extension
		if ( file.substr( file.length - 5 ) !== ".html" ) {
			return fn( new Error( "Invalid file extension for " + file + "; must be .html." ) );
		}

		// Verify parent
		if ( post.__parent && !postPaths[ post.__parent ] ) {
			return fn( new Error( file + " does not have a parent." ) );
		}

		// Verify required data
		if ( !post.title ) {
			return fn( new Error( file + " is missing required data: title" ) );
		}

		count++;
		fn( null );
	}, function( error ) {
		if ( error ) {
			grunt.log.error( error );
			return fn( error );
		}

		var msg = "Validated " + (count === 1 ?
			"one post." :
			(count + " posts."));
		grunt.log.writeln( msg );
		fn( null );
	});
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
				var checksum,
					existingPost = postPaths[ post.__postPath ],
					name = prettyName( post.__postPath );

				function complete( error, id ) {
					if ( error ) {
						return fn( error );
					}

					posts[ post.__postPath ] = id;
					delete postPaths[ post.__postPath ];
					fn( null );
				}

				if ( !post.status ) {
					post.status = "publish";
				}
				if ( post.__parent ) {
					post.parent = posts[ post.__parent ];
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

				// If the post exists and hasn't changed, then there's nothing to do.
				checksum = createChecksum( post );
				if ( existingPost ) {
					// Don't add the id until after creating the checksum. This allows us
					// to create the same checksum when creating and editing.
					post.id = existingPost.id;

					if ( existingPost.checksum === checksum ) {
						grunt.verbose.writeln( "Skipping " + name + "; already up-to-date." );
						return complete( null, post.id );
					}
				}

				// Add a checksum so we can determine when a post has been edited
				post.customFields = post.customFields || [];
				post.customFields.push({
					key: "gwcs",
					value: checksum
				});

				grunt.helper( "wordpress-publish-post", post, complete );
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
				grunt.helper( "wordpress-delete-post", postPaths[ postPath ].id, postPath, fn );
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

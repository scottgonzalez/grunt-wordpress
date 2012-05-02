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

// Converts a term to a readable name, e.g., { taxonomy: "foo", name: "bar" } to "foo bar"
function prettyTermName( term ) {
	return term.taxonomy + " " + term.name;
}

function getTaxonomies( fn ) {
	var client = getClient();

	async.waterfall([
		function getAllTaxonomies( fn ) {
			grunt.verbose.write( "Getting taxonomies from WordPress..." );
			client.getTaxonomies( fn );
		},

		function getAllTerms( taxonomies, fn ) {
			var all = {};
			grunt.verbose.ok();
			async.forEachSeries( taxonomies, function( taxonomy, fn ) {
				all[ taxonomy.name ] = {};
				grunt.verbose.write( "Getting " + taxonomy.name + " terms..." );
				client.getTerms( taxonomy.name, function( error, terms ) {
					if ( error ) {
						grunt.verbose.error();
						grunt.verbose.or.error( "Error getting " + taxonomy.name + "." );
						return fn( error );
					}

					grunt.verbose.ok();
					terms.forEach(function( term ) {
						all[ taxonomy.name ][ term.name ] = term;
					});
					fn( null );
				});
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, all );
			});
		}
	], fn );
}

function createTerm( term, fn ) {
	var client = getClient(),
		name = prettyTermName( term );

	if ( term.termId ) {
		grunt.verbose.write( "Editing " + name + "..." );
		client.editTerm( term.termId, term, function( error ) {
			if ( error ) {
				grunt.verbose.error();
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Edited " + name + "." );
			fn( null, term.termId );
		});
	} else {
		grunt.verbose.write( "Creating " + name + "..." );
		client.newTerm( term, function( error, termId ) {
			if ( error ) {
				grunt.verbose.error();
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Created " + name + "." );
			fn( null, termId );
		});
	}
}

function processTaxonomies( path, fn ) {
	var taxonomies,
		client = getClient();

	grunt.verbose.writeln( "Processing taxonomies.".bold );
	try {
		taxonomies = grunt.file.readJSON( path );
	} catch( error ) {
		grunt.log.error( "Invalid taxonomy definitions file." );
		return fn( error );
	}

	async.waterfall([
		getTaxonomies,

		function publishTaxonomies( existingTaxonomies, fn ) {
			async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, fn ) {
				// Taxonomies must already exist in WordPress
				if ( !existingTaxonomies[ taxonomy ] ) {
					grunt.log.error( "Taxonomies must exist in WordPress prior to use in taxonomies.json." );
					return fn( new Error( "Invalid taxonomy: " + taxonomy ) );
				}

				function process( terms, parent, fn ) {
					async.forEachSeries( terms, function( term, fn ) {
						if ( existingTaxonomies[ taxonomy ][ term.name ] ) {
							term.termId = existingTaxonomies[ taxonomy ][ term.name ].termId;
						}
						term.taxonomy = taxonomy;
						term.parent = parent;
						createTerm( term, function( error, termId ) {
							if ( error ) {
								grunt.verbose.or.error( "Error processing " + prettyTermName( term ) + "." );
								return fn( error );
							}

							delete existingTaxonomies[ taxonomy ][ term.name ];
							if ( !term.children ) {
								return fn( null, termId );
							}

							// Process child terms
							process( term.children, termId, fn );
						});
					}, function( error ) {
						fn( error );
					});
				}

				// Process top level terms
				grunt.verbose.writeln( "Processing terms.".bold );
				process( taxonomies[ taxonomy ], null, fn );
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, existingTaxonomies );
			});
		},

		// TODO: Don't delete taxonomies until after processing posts.
		// This will allow us to use keywords without defining all of them upfront.
		function deleteTaxonomies( taxonomies, fn ) {
			grunt.verbose.writeln( "Deleting old terms.".bold );
			async.map( Object.keys( taxonomies ), function( taxonomyName, fn ) {
				var taxonomy = taxonomies[ taxonomyName ];
				async.forEachSeries( Object.keys( taxonomy ), function( term, fn ) {
					var name;
					term = taxonomy[ term ];
					name = prettyTermName( term );
					grunt.verbose.write( "Deleting " + name + "..." );
					client.deleteTerm( taxonomyName, term.termId, function( error ) {
						if ( error ) {
							grunt.verbose.error();
							grunt.verbose.or.error( "Error deleting " + name + "." );
							return fn( error );
						}

						grunt.verbose.ok();
						grunt.verbose.or.writeln( "Deleted " + name + "." );
						fn( null );
					});
				}, fn );
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null );
			});
		}
	], function( error ) {
		fn( error );
	});
}

// TODO: Smarter updates (compare checksums and only republish if there were changes)
grunt.registerTask( "wordpress-publish", "Generate posts in WordPress from HTML files", function() {
	this.requires( "wordpress-validate" );
	var done = this.async();
	async.waterfall([
		function taxonomies( fn ) {
			var taxonomiesPath = "dist/taxonomies.json";
			if ( path.existsSync( taxonomiesPath ) ) {
				processTaxonomies( taxonomiesPath, fn );
			} else {
				fn( null );
			}
		},

		function getPostPaths( fn ) {
			grunt.verbose.write( "Getting post paths from WordPress..." );
			getClient().call( "gw.getPostPaths", "any", fn );
		},

		function publishPosts( postPaths, fn ) {
			var posts = {};
			grunt.verbose.ok();

			grunt.verbose.writeln();
			grunt.verbose.writeln( "Publishing posts.".bold );
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
			var client = getClient();

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
		count = 0;

	// TODO:
	// - Verify that there are no files directly inside dist/
	//    - Except for taxonomies.json
	// - Verify that all child posts actually have parents
	//    - All directories must have a matching file
	// - Verify that all files have .html extension
	// - Verify required metadata
	//    - Title, anything else?
	// - Verify gw.getPostPaths exists
	// - Verify that jQuery Slugs plugin exists

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
		var post,
			postPath = file.substr( dir.length, file.length - dir.length - 5 ),
			parts = postPath.split( "/" ),
			name = parts.pop(),
			parent = parts.length > 1 ? parts.join( "/" ) : null,
			type = parts.shift();

		// If there's no type, then we're in the root and looking at metadata
		if ( !type ) {
			return fn( null );
		}

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
	var client = getClient(),
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

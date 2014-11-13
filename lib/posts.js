module.exports = function( Client ) {

var fs = require( "fs" );
var async = require( "async" );

// Converts a postPath to a more readable name, e.g., "page/foo/bar" to "page foo/bar"
function prettyName( postPath ) {
	return postPath.replace( "/", " " );
}

Client.prototype.getPostPaths = function( callback ) {
	callback = callback.bind( this );

	if ( this.verbose ) {
		this.log( "Getting post paths from WordPress..." );
	}

	this.client.call( "gw.getPostPaths", "any", function( error, postPaths ) {
		if ( error ) {
			return callback( error );
		}

		if ( this.verbose ) {
			this.log( "Got post paths from WordPress." );
		}

		callback( null, postPaths );
	});
};

Client.prototype.walkPosts = function( dir, walkFn, complete ) {
	walkFn = walkFn.bind( this );
	complete = complete.bind( this );

	this.recurse( dir, function( file, callback ) {
		this.parsePost( file, function( error, post ) {
			if ( error ) {
				return callback( error );
			}

			var postPath = file.substr( dir.length, file.length - dir.length - 5 );
			var parts = postPath.split( "/" );
			var name = parts.pop();
			var parent = parts.length > 1 ? parts.join( "/" ) : null;
			var type = parts.shift();

			post.type = type;
			post.name = name;
			post.__parent = parent;
			post.__postPath = postPath;
			post.__file = file;

			walkFn( post, callback );
		});
	}, complete );
};

// Parse an html file into a post object. The metadata for the post is read
// out of a <script> element containing JSON at the top of the file.
Client.prototype.parsePost = function( path, callback ) {
	callback = callback.bind( this );

	fs.readFile( path, { encoding: "utf8" }, function( error, content ) {
		if ( error ) {
			return callback( error );
		}

		var post = {};

		// The metadata is optional, if it exists it must be the first characater
		if ( content.substring( 0, 8 ) === "<script>" ) {
			try {
				var index = content.indexOf( "</script>" );
				post = JSON.parse( content.substr( 8, index - 8 ) );

				if ( "date" in post ) {
					post.date = new Date( post.date );
				}
				if ( "modified" in post ) {
					post.modified = new Date( post.modified );
				}

				content = content.substr( index + 9 );
			} catch( error ) {
				return callback( new Error( "Invalid JSON metadata for " + path ) );
			}
		}

		post.content = content;
		callback( null, post );
	});
};

Client.prototype.validatePosts = function( dir, callback ) {
	callback = callback.bind( this );

	var count = 0;
	var postPaths = {};

	this.walkPosts( dir, function( post, callback ) {
		// If there's a problem parsing the content of the file, then walkPosts()
		// will return an error and we'll automatically stop walking. So we know that the
		// content and structure of the metadata is already valid.
		var file = post.__file;

		postPaths[ post.__postPath ] = true;

		// Verify file extension
		if ( file.substr( file.length - 5 ) !== ".html" ) {
			return callback( new Error( "Invalid file extension for " + file + "; must be .html." ) );
		}

		// Verify parent
		if ( post.__parent && !postPaths[ post.__parent ] ) {
			return callback( new Error( file + " does not have a parent." ) );
		}

		// Verify required data
		if ( !post.title ) {
			return callback( new Error( file + " is missing required data: title" ) );
		}

		count++;
		callback( null );
	}, function( error ) {
		if ( error ) {
			return callback( error );
		}

		var msg = "Validated " + (
			count === 1 ?
				"one post." :
				(count + " posts.")
			);
		this.log( msg );

		callback( null );
	}.bind( this ));
};

// Publish (create or update) a post to WordPress.
Client.prototype.publishPost = function( post, callback ) {
	callback = callback.bind( this );

	var name = prettyName( post.__postPath );

	if ( post.id ) {
		// Get existing custom fields

		if ( this.verbose ) {
			this.log( "Getting custom fields for " + name + "..." );
		}

		this.client.getPost( post.id, [ "customFields" ], function( error, postData ) {
			if ( error ) {
				return callback( error );
			}

			if ( this.verbose ) {
				this.log( "Got custom fields for " + name + "." );
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
			if ( this.verbose ) {
				this.log( "Editing " + name + "..." );
			}

			this.client.editPost( post.id, post, function( error ) {
				if ( error ) {
					return callback( error );
				}

				this.log( "Edited " + name + "." );
				callback( null, post.id );
			});
		});
	} else {
		if ( this.verbose ) {
			this.log( "Creating " + name + "..." );
		}

		this.client.newPost( post, function( error, id ) {
			if ( error ) {
				return callback( error );
			}

			this.log( "Created " + name + "." );
			callback( null, id );
		});
	}
};

Client.prototype.deletePost = function( postId, postPath, callback ) {
	callback = callback.bind( this );

	var name = prettyName( postPath );

	if ( this.verbose ) {
		this.log( "Trashing " + name + "..." );
	}

	this.client.deletePost( postId, function( error ) {
		if ( error ) {
			return callback( error );
		}

		if ( this.verbose ) {
			this.log( "Trashed " + name + "." );
		}

		// The first delete moves to trash; this one deletes :-)

		if ( this.verbose ) {
			this.log( "Deleting " + name + "..." );
		}

		this.client.deletePost( postId, function( error ) {
			if ( error ) {
				return callback( error );
			}

			this.log( "Deleted " + name + "." );
			callback( null );
		});
	});
};

Client.prototype.syncPosts = function( path, termMap, callback ) {
	callback = callback.bind( this );

	this.waterfall([
		function getPostPaths( callback ) {
			this.getPostPaths( callback );
		},

		function publishPosts( postPaths, callback ) {
			var posts = {};

			if ( this.verbose ) {
				this.log( "Publishing posts..." );
			}

			this.walkPosts( path, function( post, callback ) {
				var existingPost = postPaths[ post.__postPath ];
				var name = prettyName( post.__postPath );

				function complete( error, id ) {
					if ( error ) {
						return callback( error );
					}

					posts[ post.__postPath ] = id;
					delete postPaths[ post.__postPath ];
					callback( null );
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
							return callback( new Error(
								name + " has '" + taxonomy + "' term slugs, " +
								"but no such taxonomy exists." ) );
						}

						post.terms[ taxonomy ] = [];
						post.termSlugs[ taxonomy ].forEach(function( slug ) {
							var termId = termMap[ taxonomy ][ slug ];

							// Check if the slug exists
							if ( !termId ) {
								return callback( new Error(
									name + " has a " + taxonomy + " term slug of " +
									"'" + slug + "', but no such term exists." ) );
							}

							post.terms[ taxonomy ].push( termId );
						});
					});
				}

				// If the post exists and hasn't changed, then there's nothing to do.
				var checksum = this.createChecksum( post );
				if ( existingPost ) {
					// Don't add the id until after creating the checksum. This allows us
					// to create the same checksum when creating and editing.
					post.id = existingPost.id;

					if ( existingPost.checksum === checksum ) {
						if ( this.verbose ) {
							this.log( "Skipping " + name + "; already up-to-date." );
						}

						return complete( null, post.id );
					}
				}

				// Add a checksum so we can determine when a post has been edited
				post.customFields = post.customFields || [];
				post.customFields.push({
					key: "gwcs",
					value: checksum
				});

				this.publishPost( post, complete );
			}.bind( this ), function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Published all posts." );
				}

				callback( null, postPaths );
			});
		},

		function deletePosts( postPaths, callback ) {
			if ( this.verbose ) {
				this.log( "Deleting old posts..." );
			}

			async.map( Object.keys( postPaths ), function( postPath, callback ) {
				this.deletePost( postPaths[ postPath ].id, postPath, callback );
			}.bind( this ), function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Deleted all old posts." );
				}

				callback( null );
			}.bind( this ));
		}
	], callback );
};

};

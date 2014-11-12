module.exports = function( Client ) {

var fs = require( "fs" );
var async = require( "async" );

// Converts a term to a readable name, e.g., { taxonomy: "foo", slug: "bar" } to "foo bar"
function prettyTermName( term ) {
	return term.taxonomy + " " + term.slug;
}

Client.prototype.readTerms = function( filepath, callback ) {
	fs.readFile( filepath, function( error, taxonomies ) {
		if ( error ) {
			// Taxonomies are optional, so a missing file is ok
			if ( error.code === "ENOENT" ) {
				return callback( null, {} );
			}

			return callback( error );
		}

		try {
			taxonomies = JSON.parse( taxonomies );
		} catch( error ) {
			this.logError( "Invalid taxonomy definitions file." );
			return callback( error );
		}

		callback( null, taxonomies );
	}.bind( this ));
};

Client.prototype.validateTerms = function( filepath, callback ) {
	var count = 0;

	this.readTerms( filepath, function( error, taxonomies ) {
		if ( error ) {
			return callback( error );
		}

		async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, callback ) {
			function process( terms, callback ) {
				var termNames = [];
				async.forEachSeries( terms, function( term, callback ) {
					if ( !term.name ) {
						return callback( new Error( "A " + taxonomy + " term has no name." ) );
					}
					if ( termNames.indexOf( term.name ) !== -1 ) {
						return callback( new Error(
							"There are multiple " + taxonomy + " " + term.name + " terms." ) );
					}
					if ( !term.slug ) {
						return callback( new Error(
							"The " + taxonomy + " term " + term.name + " has no slug." ) );
					}
					if ( !(/^([a-zA-Z0-9]+[.\-]?)+$/).test( term.slug ) ) {
						return callback( new Error( "Invalid slug: " + term.slug + "." ) );
					}

					termNames.push( term.name );
					count++;

					if ( term.children ) {
						return process( term.children, callback );
					}

					callback( null );
				}, callback );
			}

			process( taxonomies[ taxonomy ], callback );
		}, function( error ) {
			if ( error ) {
				return callback( error );
			}

			var msg = "Validated " + (count === 1 ?
				"one term." :
				(count + " terms."));
			this.log( msg );

			callback( null );
		}.bind( this ));
	}.bind( this ));
};

Client.prototype.getTerms = function( callback ) {
	async.waterfall([
		function getTaxonomies( callback ) {
			if ( this.verbose ) {
				this.log( "Getting taxonomies from WordPress..." );
			}

			this.client.getTaxonomies( callback );
		}.bind( this ),

		function getTerms( taxonomies, callback ) {
			if ( this.verbose ) {
				this.log( "Got taxonomies from WordPress." );
			}

			var existingTerms = {};

			async.forEachSeries( taxonomies, function( taxonomy, callback ) {
				existingTerms[ taxonomy.name ] = {};

				if ( this.verbose ) {
					this.log( "Getting " + taxonomy.name + " terms..." );
				}

				this.client.getTerms( taxonomy.name, function( error, terms ) {
					if ( error ) {
						return callback( error );
					}

					if ( this.verbose ) {
						this.log( "Got " + taxonomy.name + " terms." );
					}

					var idMap = {};

					function expandSlug( term ) {
						var slug = term.slug;
						while ( term.parent !== "0" ) {
							term = idMap[ term.parent ];
							slug = term.slug + "/" + slug;
						}
						return slug;
					}

					terms.forEach(function( term ) {
						idMap[ term.termId ] = term;
					});

					terms.forEach(function( term ) {
						existingTerms[ taxonomy.name ][ expandSlug( term ) ] = term;
					});

					callback( null );
				}.bind( this ));
			}.bind( this ), function( error ) {
				if ( error ) {
					return callback( error );
				}

				callback( null, existingTerms );
			});
		}.bind( this )
	], callback );
};

Client.prototype.publishTerm = function( term, callback ) {
	var name = prettyTermName( term );

	if ( term.termId ) {
		if ( this.verbose ) {
			this.log( "Editing " + name + "..." );
		}

		this.client.editTerm( term.termId, term, function( error ) {
			if ( error ) {
				return callback( error );
			}

			this.log( "Edited " + name + "." );
			callback( null, term.termId );
		}.bind( this ));
	} else {
		if ( this.verbose ) {
			this.log( "Creating " + name + "..." );
		}

		this.client.newTerm( term, function( error, termId ) {
			if ( error ) {
				return callback( error );
			}

			this.log( "Created " + name + "." );
			callback( null, termId );
		}.bind( this ));
	}
};

Client.prototype.deleteTerm = function( term, callback ) {
	var name = prettyTermName( term );

	if ( this.verbose ) {
		this.log( "Deleting " + name + "..." );
	}

	this.client.deleteTerm( term.taxonomy, term.termId, function( error ) {
		if ( error ) {
			return callback( error );
		}

		this.log( "Deleted " + name + "." );
		callback( null );
	}.bind( this ));
};

Client.prototype.syncTerms = function( filepath, callback ) {
	if ( this.verbose ) {
		this.log( "Synchronizing terms..." );
	}

	async.waterfall([
		function getTerms( callback ) {
			this.getTerms( callback );
		}.bind( this ),

		function publishTerms( existingTerms, callback ) {
			var termMap = {};

			if ( this.verbose ) {
				this.log( "Publishing terms..." );
			}

			this.readTerms( filepath, function( error, taxonomies ) {
				if ( error ) {
					return callback( error );
				}

				async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, callback ) {
					// Taxonomies must already exist in WordPress
					if ( !existingTerms[ taxonomy ] ) {
						this.logError( "Taxonomies must exist in WordPress prior to use in taxonomies.json." );
						return callback( new Error( "Invalid taxonomy: " + taxonomy ) );
					}

					if ( this.verbose ) {
						this.log( "Publishing " + taxonomy + " terms..." );
					}

					termMap[ taxonomy ] = {};

					var process = function( terms, parent, callback ) {
						async.forEachSeries( terms, function( term, callback ) {
							term.__slug = (parent ? parent.__slug + "/" : "") + term.slug;
							if ( existingTerms[ taxonomy ][ term.__slug ] ) {
								term.termId = existingTerms[ taxonomy ][ term.__slug ].termId;
							}
							// TODO: check if a term with the same name already exists
							term.taxonomy = taxonomy;
							term.parent = parent ? parent.termId : null;

							this.publishTerm( term, function( error, termId ) {
								if ( error ) {
									this.logError( "Error publishing " + prettyTermName( term ) + "." );
									return callback( error );
								}

								term.termId = termId;
								termMap[ taxonomy ][ term.__slug ] = termId;
								function done( error ) {
									if ( error ) {
										return callback( error );
									}

									delete existingTerms[ taxonomy ][ term.__slug ];
									callback( null, termId );
								}

								if ( !term.children ) {
									return done();
								}

								// Process child terms
								process( term.children, term, done );
							}.bind( this ));
						}.bind( this ), function( error ) {
							callback( error );
						});
					}.bind( this );

					// Process top level terms
					process( taxonomies[ taxonomy ], null, function( error ) {
						if ( error ) {
							return callback( error );
						}

						if ( this.verbose ) {
							this.log( "Published " + taxonomy + " terms." );
						}

						callback( null );
					}.bind( this ));
				}.bind( this ), function( error ) {
					if ( error ) {
						return callback( error );
					}

					if ( this.verbose ) {
						this.log( "Published all terms." );
					}

					callback( null, termMap, existingTerms );
				}.bind( this ));
			}.bind( this ));
		}.bind( this ),

		// TODO: Don't delete terms until after processing posts.
		// This will allow us to use keywords without defining all of them upfront.
		function deleteTerms( termMap, existingTerms, callback ) {
			if ( this.verbose ) {
				this.log( "Deleting old terms..." );
			}

			async.map( Object.keys( existingTerms ), function( taxonomy, callback ) {
				var terms = existingTerms[ taxonomy ];
				async.forEachSeries( Object.keys( terms ), function( term, callback ) {
					this.deleteTerm( terms[ term ], callback );
				}.bind( this ), callback );
			}.bind( this ), function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Deleted all old terms." );
				}

				callback( null, termMap );
			}.bind( this ));
		}.bind( this )
	], callback );
};

};

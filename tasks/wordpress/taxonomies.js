module.exports = function( grunt ) {

var path = require( "path" ),
	async = grunt.utils.async;

// Converts a term to a readable name, e.g., { taxonomy: "foo", slug: "bar" } to "foo bar"
function prettyTermName( term ) {
	return term.taxonomy + " " + term.slug;
}

// TODO: Check for existing terms with same name, but different slug
grunt.registerHelper( "wordpress-validate-terms", function( filepath, fn ) {
	var taxonomies,
		client = grunt.helper( "wordpress-client" ),
		count = 0;

	function complete() {
		grunt.log.writeln( "Validated " + count + " terms." );
		fn( null );
	}

	if ( !path.existsSync( filepath ) ) {
		return complete();
	}

	// Check if the taxonomies JSON format is valid
	try {
		taxonomies = grunt.file.readJSON( filepath );
	} catch( error ) {
		grunt.log.error( "Invalid taxonomy definitions file." );
		return fn( error );
	}

	async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, fn ) {
		function process( terms, fn ) {
			async.forEachSeries( terms, function( term, fn ) {
				if ( !term.name ) {
					return fn( new Error( "A " + taxonomy + " term has no name." ) );
				}
				if ( !term.slug ) {
					return fn( new Error( "The " + taxonomy + " term " + term.name + " has no slug." ) );
				}
				if ( !(/^([a-zA-Z0-9]+[.\-]?)+$/).test( term.slug ) ) {
					return fn( new Error( "Invalid slug: " + term.slug + "." ) );
				}

				count++;
				if ( term.children ) {
					return process( term.children, fn );
				}

				fn( null );
			}, fn );
		}

		process( taxonomies[ taxonomy ], fn );
	}, function( error ) {
		if ( error ) {
			return fn( error );
		}

		complete();
	});
});

grunt.registerHelper( "wordpress-get-terms", function( fn ) {
	var client = grunt.helper( "wordpress-client" );

	async.waterfall([
		function getTaxonomies( fn ) {
			grunt.verbose.write( "Getting taxonomies from WordPress..." );
			client.getTaxonomies( fn );
		},

		function getTerms( taxonomies, fn ) {
			var existingTerms = {};
			grunt.verbose.ok();

			async.forEachSeries( taxonomies, function( taxonomy, fn ) {
				existingTerms[ taxonomy.name ] = {};
				grunt.verbose.write( "Getting " + taxonomy.name + " terms..." );
				client.getTerms( taxonomy.name, function( error, terms ) {
					var idMap = {};

					if ( error ) {
						grunt.verbose.error();
						grunt.verbose.or.error( "Error getting " + taxonomy.name + "." );
						return fn( error );
					}

					grunt.verbose.ok();

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
					fn( null );
				});
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, existingTerms );
			});
		}
	], fn );
});

grunt.registerHelper( "wordpress-publish-term", function( term, fn ) {
	var client = grunt.helper( "wordpress-client" ),
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
});

grunt.registerHelper( "wordpress-delete-term", function( term, fn ) {
	var client = grunt.helper( "wordpress-client" ),
		name = prettyTermName( term );

	grunt.verbose.write( "Deleting " + name + "..." );
	client.deleteTerm( term.taxonomy, term.termId, function( error ) {
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

grunt.registerHelper( "wordpress-sync-terms", function( filepath, fn ) {
	var taxonomies,
		client = grunt.helper( "wordpress-client" );

	grunt.verbose.writeln( "Synchronizing terms.".bold );

	// Check if there are any terms to process
	if ( !path.existsSync( filepath ) ) {
		grunt.verbose.writeln( "No terms to process." );
		grunt.verbose.writeln();
		return fn( null );
	}

	// Check if the taxonomies JSON format is valid
	try {
		taxonomies = grunt.file.readJSON( filepath );
	} catch( error ) {
		grunt.log.error( "Invalid taxonomy definitions file." );
		return fn( error );
	}

	async.waterfall([
		function getTerms( fn ) {
			grunt.helper( "wordpress-get-terms", fn );
		},

		function publishTerms( existingTerms, fn ) {
			var termMap = {};

			grunt.verbose.writeln( "Processing terms.".bold );
			async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, fn ) {
				// Taxonomies must already exist in WordPress
				if ( !existingTerms[ taxonomy ] ) {
					grunt.log.error( "Taxonomies must exist in WordPress prior to use in taxonomies.json." );
					return fn( new Error( "Invalid taxonomy: " + taxonomy ) );
				}

				grunt.verbose.writeln( ("Processing " + taxonomy + " terms.").bold );
				termMap[ taxonomy ] = {};

				function process( terms, parent, fn ) {
					async.forEachSeries( terms, function( term, fn ) {
						term.__slug = (parent ? parent.__slug + "/" : "") + term.slug;
						if ( existingTerms[ taxonomy ][ term.__slug ] ) {
							term.termId = existingTerms[ taxonomy ][ term.__slug ].termId;
						}
						term.taxonomy = taxonomy;
						term.parent = parent ? parent.termId : null;

						grunt.helper( "wordpress-publish-term", term, function( error, termId ) {
							if ( error ) {
								grunt.verbose.or.error( "Error processing " + prettyTermName( term ) + "." );
								return fn( error );
							}

							term.termId = termId;
							termMap[ taxonomy ][ term.__slug ] = termId;
							function done( error ) {
								if ( error ) {
									return fn( error );
								}

								delete existingTerms[ taxonomy ][ term.__slug ];
								fn( null, termId );
							}

							if ( !term.children ) {
								return done();
							}

							// Process child terms
							process( term.children, term, done );
						});
					}, function( error ) {
						fn( error );
					});
				}

				// Process top level terms
				process( taxonomies[ taxonomy ], null, fn );
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, termMap, existingTerms );
			});
		},

		// TODO: Don't delete terms until after processing posts.
		// This will allow us to use keywords without defining all of them upfront.
		function deleteTerms( termMap, existingTerms, fn ) {
			grunt.verbose.writeln( "Deleting old terms.".bold );
			async.map( Object.keys( existingTerms ), function( taxonomy, fn ) {
				var terms = existingTerms[ taxonomy ];
				async.forEachSeries( Object.keys( terms ), function( term, fn ) {
					grunt.helper( "wordpress-delete-term", terms[ term ], fn );
				}, fn );
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, termMap );
			});
		}
	], fn );
});

};

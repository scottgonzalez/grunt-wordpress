module.exports = function( grunt ) {

var async = grunt.utils.async;

// Converts a term to a readable name, e.g., { taxonomy: "foo", slug: "bar" } to "foo bar"
function prettyTermName( term ) {
	return term.taxonomy + " " + term.slug;
}

grunt.registerHelper( "wordpress-get-terms", function( fn ) {
	var client = grunt.helper( "wordpress-client" );

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
						all[ taxonomy.name ][ expandSlug( term ) ] = term;
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

function processTaxonomies( path, fn ) {
	var taxonomies,
		client = grunt.helper( "wordpress-client" );

	grunt.verbose.writeln( "Processing taxonomies.".bold );
	try {
		taxonomies = grunt.file.readJSON( path );
	} catch( error ) {
		grunt.log.error( "Invalid taxonomy definitions file." );
		return fn( error );
	}

	async.waterfall([
		function getTaxonomies( fn ) {
			grunt.helper( "wordpress-get-terms", fn );
		},

		function publishTaxonomies( existingTaxonomies, fn ) {
			async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, fn ) {
				// Taxonomies must already exist in WordPress
				if ( !existingTaxonomies[ taxonomy ] ) {
					grunt.log.error( "Taxonomies must exist in WordPress prior to use in taxonomies.json." );
					return fn( new Error( "Invalid taxonomy: " + taxonomy ) );
				}

				function process( terms, parent, fn ) {
					async.forEachSeries( terms, function( term, fn ) {
						term.__slug = (parent ? parent.__slug + "/" : "") + term.slug;
						if ( existingTaxonomies[ taxonomy ][ term.__slug ] ) {
							term.termId = existingTaxonomies[ taxonomy ][ term.__slug ].termId;
						}
						term.taxonomy = taxonomy;
						term.parent = parent ? parent.termId : null;
						grunt.helper( "wordpress-publish-term", term, function( error, termId ) {
							if ( error ) {
								grunt.verbose.or.error( "Error processing " + prettyTermName( term ) + "." );
								return fn( error );
							}

							term.termId = termId;
							function done( error ) {
								if ( error ) {
									return fn( error );
								}

								delete existingTaxonomies[ taxonomy ][ term.__slug ];
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
					grunt.helper( "wordpress-delete-term", taxonomy[ term ], fn );
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

return {
	process: processTaxonomies
};

};
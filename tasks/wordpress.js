/*
 * grunt-wordpress
 * https://github.com/scottgonzalez/grunt-wordpress
 *
 * Copyright (c) 2012 Scott González
 * Licensed under the MIT license.
 */

module.exports = function( grunt ) {

// TODO: support for static resources (requires new XML-RPC method)

require( grunt.task.getFile( "wordpress/posts.js" ) )( grunt );

var _client,
	path = require( "path" ),
	wordpress = require( "wordpress" ),
	taxonomies = require( grunt.task.getFile( "wordpress/taxonomies.js" ) )( grunt ),
	async = grunt.utils.async;

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
			grunt.helper( "wordpress-get-postpaths", fn );
		},

		function publishPosts( postPaths, fn ) {
			var posts = {};

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
				grunt.helper( "wordpress-delete-post", postPaths[ postPath ], postPath, fn );
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

grunt.registerTask( "wordpress-deploy", "build wordpress-validate wordpress-publish" );

};

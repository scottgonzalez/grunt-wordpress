var path = require( "path" );
var util = require( "util" );
var crypto = require( "crypto" );
var wordpress = require( "wordpress" );
var async = require( "async" );
var glob = require( "glob" );
var version = require( "./package" ).version;

exports.createClient = createClient;
exports.Client = Client;

function createClient( options ) {
	return new Client( options );
}

function Client( options ) {
	this.options = options;
	this.verbose = options.verbose || false;
	this.client = wordpress.createClient( options );
}

// Async directory recursion, always walks all files before recursing
Client.recurse = function( rootdir, walkFn, complete ) {
	glob( rootdir + "/*", { mark: true }, function( error, entries ) {
		if ( error ) {
			return complete( error );
		}

		var directories = [];
		var files = entries.filter(function( entry ) {
			if ( /\/$/.test( entry ) ) {
				directories.push( entry );
				return false;
			}

			return true;
		});

		async.forEachSeries( files, walkFn, function( error ) {
			if ( error ) {
				return complete( error );
			}

			async.forEachSeries( directories, function( directory, directoryComplete ) {
				Client.recurse( directory, walkFn, directoryComplete );
			}, complete );
		});
	});
};

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

Client.createChecksum = function( obj ) {
	var md5 = crypto.createHash( "md5" );
	md5.update( flatten( obj ), "utf8" );
	return md5.digest( "hex" );
};

Client.prototype.log = console.log;
Client.prototype.logError = console.error;

Client.prototype.validateXmlrpcVersion = function( callback ) {
	if ( this.verbose ) {
		this.log( "Verifying XML-RPC version..." );
	}

	this.client.authenticatedCall( "gw.getVersion", function( error, xmlrpcVersion ) {
		if ( error ) {
			if ( error.code === "ECONNREFUSED" ) {
				return callback( new Error( "Could not connect to WordPress." ) );
			}
			if ( error.code === -32601 ) {
				return callback( new Error(
					"XML-RPC extensions for grunt-wordpress are not installed." ) );
			}
			if ( !error.code ) {
				return callback( new Error( "Unknown error. " +
					"Please ensure that your database server is running " +
					"and WordPress is functioning properly." ) );
			}

			// XML-RPC is disabled or bad credentials
			// WordPress provides good error messages, so we don't do any special handling
			return callback( error );
		}

		if ( xmlrpcVersion !== version ) {
			return callback( new Error( "Mismatching versions for grunt-wordpress. " +
				"Version " + version + " is installed as a Grunt plugin, " +
				"but the WordPress server is running version " + xmlrpcVersion + "." ) );
		}

		if ( this.verbose ) {
			this.log( "XML-RPC version matches Grunt version." );
		}

		callback( null );
	}.bind( this ));
};

Client.prototype.validate = function( callback ) {
	var dir = this.options.dir;

	async.waterfall([
		function validateXmlrpcVersion( callback ) {
			this.validateXmlrpcVersion( callback );
		}.bind( this ),

		function validateTerms( callback ) {
			this.validateTerms( path.join( dir, "taxonomies.json" ), callback );
		}.bind( this ),

		function validatePosts( callback ) {
			this.validatePosts( path.join( dir, "posts/" ), callback );
		}.bind( this )
	], function( error ) {
		if ( error ) {
			return callback( error );
		}

		callback( null );
	});
};

Client.prototype.sync = function( callback ) {
	var dir = this.options.dir;

	async.waterfall([
		function syncTerms( callback ) {
			this.syncTerms( path.join( dir, "taxonomies.json" ), callback );
		}.bind( this ),

		function syncPosts( termMap, callback ) {
			this.syncPosts( path.join( dir, "posts/" ), termMap, callback );
		}.bind( this ),

		function syncResources( callback ) {
			this.syncResources( path.join( dir, "resources/" ), callback );
		}.bind( this )
	], function( error ) {
		if ( error ) {
			if ( error.code === "ECONNREFUSED" ) {
				this.logError( "Could not connect to WordPress XML-RPC server." );
			}

			return callback( error );
		}

		callback( null );
	}.bind( this ));
};

[ "posts", "taxonomies", "resources" ].forEach(function( module ) {
	require( "./lib/" + module )( Client );
});

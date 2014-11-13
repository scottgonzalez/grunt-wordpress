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
	this.bindClientMethods();
}

Client.prototype.log = console.log;
Client.prototype.logError = console.error;

Client.prototype.bindClientMethods = function() {
	var context = this;
	var client = this.client;

	function bindContext( property ) {
		if ( typeof client[ property ] !== "function" ) {
			return;
		}

		var original = client[ property ];
		client[ property ] = function() {
			if ( !arguments.length ) {
				return;
			}

			var args = [].slice.apply( arguments );
			var last = args.pop();
			if ( typeof last === "function" ) {
				last = last.bind( context );
			}
			args.push( last );

			original.apply( client, args );
		};
	}

	for ( var property in client ) {
		bindContext( property );
	}
};

Client.prototype.waterfall = function( steps, callback ) {
	var context = this;

	async.waterfall(
		steps.map(function( step ) {
			return step.bind( context );
		}),
		callback.bind( context )
	);
};

Client.prototype.forEach = function( items, eachFn, complete ) {
	async.forEachSeries( items, eachFn.bind( this ), complete.bind( this ) );
};

// Async directory recursion, always walks all files before recursing
Client.prototype.recurse = function( rootdir, walkFn, complete ) {
	complete = complete.bind( this );

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

		this.forEach( files, walkFn, function( error ) {
			if ( error ) {
				return complete( error );
			}

			this.forEach( directories, function( directory, directoryComplete ) {
				this.recurse( directory, walkFn, directoryComplete );
			}, complete );
		});
	}.bind( this ));
};

Client.prototype.createChecksum = (function() {
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

	return function( obj ) {
		var md5 = crypto.createHash( "md5" );
		md5.update( flatten( obj ), "utf8" );
		return md5.digest( "hex" );
	};
})();

Client.prototype.validateXmlrpcVersion = function( callback ) {
	callback = callback.bind( this );

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
	});
};

Client.prototype.validate = function( callback ) {
	callback = callback.bind( this );

	var dir = this.options.dir;

	this.waterfall([
		function validateXmlrpcVersion( callback ) {
			this.validateXmlrpcVersion( callback );
		},

		function validateTerms( callback ) {
			this.validateTerms( path.join( dir, "taxonomies.json" ), callback );
		},

		function validatePosts( callback ) {
			this.validatePosts( path.join( dir, "posts/" ), callback );
		}
	], function( error ) {
		if ( error ) {
			return callback( error );
		}

		callback( null );
	});
};

Client.prototype.sync = function( callback ) {
	callback = callback.bind( this );

	var dir = this.options.dir;

	this.waterfall([
		function syncTerms( callback ) {
			this.syncTerms( path.join( dir, "taxonomies.json" ), callback );
		},

		function syncPosts( termMap, callback ) {
			this.syncPosts( path.join( dir, "posts/" ), termMap, callback );
		},

		function syncResources( callback ) {
			this.syncResources( path.join( dir, "resources/" ), callback );
		}
	], function( error ) {
		if ( error ) {
			if ( error.code === "ECONNREFUSED" ) {
				this.logError( "Could not connect to WordPress XML-RPC server." );
			}

			return callback( error );
		}

		callback( null );
	});
};

[ "posts", "taxonomies", "resources" ].forEach(function( module ) {
	require( "./lib/" + module )( Client );
});

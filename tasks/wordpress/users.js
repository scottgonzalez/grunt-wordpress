module.exports = function( grunt ){

	var crypto = require('crypto'),
		fs = require('fs'),
		path = require('path'),
		util = require('util'),
		async = grunt.utils.async;

	/*

	UserSync

	Manages the syncing of users between a Stream of JSON data defining users and
	a WordPress installation with the added RPC method calls that enable
	user management.

	Arguments:
		settings : a hash containing these options
		- client : (required) a configured node wordpress client
		- send_email: (optional) Defaults to `true` will deliver email to newly created users
		callback: method to call when sync is complete
	*/
	var UserSync = function ( client ){
		this.send_email = true;
		this.client = client;
	};

	UserSync.prototype.toString = function(){
		return "UserSync";
	};
	
	// Method used in the async.serial that disables a user
	UserSync.prototype.disableTask = function( wp_user ){
		var client = this;
		return function( done ){
			grunt.log.write("Disabling " + wp_user.username + " ... ");
			client.editUser(wp_user.user_id, { role: 'subscriber' }, function(e, response){
				if (e) {
					grunt.log.writeln("failed");
					grunt.log.error(e);
				} else {
					grunt.log.writeln("success");
				}
				done();
			});
		};
	}

	// Method used in the async.serial that edits a user
	UserSync.prototype.editTask = function( wp_user, user ){
		var client = this;
		return function( done ){
			// call editUser remote method
			grunt.log.write("Updating " + user.username + " ... ");
			client.editUser( wp_user.user_id, {
				'email'				 : user.email,
				'first_name'	 : user.first_name,
				'last_name'		 : user.last_name,
				'website'			 : user.url,
				'display_name' : user.display_name,
				'bio'					 : user.bio,
				'user_contacts': user.contacts,
				'role'				 : user.role
			}, client.send_email, function(e, response){
				if (e) {
					grunt.log.writeln("failed");
					grunt.log.error(e);
				} else {
					grunt.log.writeln("success");
				}
				done();
			} );
		};
	}

	// Method used in the async.serial that creates a user
	UserSync.prototype.createTask = function( user ){
		var client = this;
		return function( done ){
			var hash = crypto.createHash('md5'),
					password,
					seed = new String(Math.random());

			hash.update(seed.toString());
			password = hash.digest('hex');
			user.password = password.slice(0,16);
			// by default users will be authors unless otherwise specified
			user.role = user.role || 'author';

			grunt.log.write("Creating user " + user.username + " ... ");
			client.newUser(user, client.send_email, function(e, response){
				if(e){
					grunt.log.writeln("failed");
					grunt.log.error(e);
				} else {
					grunt.log.writeln("success");
				}
				done();
			});
		};
	}

	// determines which users need to be created, edited or deleted
	UserSync.prototype.operateOnUsers = function( local_users, wp_users, callback ){
			// compare users, loop through canonical users
			var tasks = [],
				client = this;
			// filter out the client user so we don't disable it
			wp_users = wp_users.filter( function( wp_user ){
				return wp_user.username.toLowerCase() != client.client.username;
			});

			local_users.forEach( function( user, index ){
				var wp_user;
				for (var i=0; i < wp_users.length; i++) {

					// assign the user to a local value
					wp_user = wp_users[i];
					if (wp_user.username.toLowerCase() == user.username.toLowerCase()) {

						// remove the user from WordPress array
						wp_users.splice(i, 1);
						tasks.push( this.editTask( wp_user, user) );
						return false;
					};
				};
				// return true;
				tasks.push( this.createTask( user ) );

			}, this );

			// remaining wp_users should be disabled since there is no matching user in JSON file
			// deleting the user will delete their posts, so instead we're going to change the user
			// role to subscriber
			wp_users.forEach(function( wp_user ){
				tasks.push( this.disableTask( wp_user ) );
			}, this);

			async.series( tasks, function( e, result ){
				callback( e, result );
			});
			return;


	};

	UserSync.prototype.run = function( stream, callback ){
		var json = "", client = this;
		// pause the stream and check if the necessary methods are available
		stream.pause();
		this.supported( function(error, supported){
			// we weren't able to detect if the user management methods are available
			if (error || supported === false) {
				if (!supported)
					error =	 new Error("WordPress XML-RPC server is missing required user management methods.");
				callback(error);
				return;
			};
			// process the stream
			stream.on( 'error', function( error ){
				callback( error );
			});
			stream.on( 'data', function( data ){
				json += data;
			} );
			stream.on( 'end', function(){
				// the canonical list if users for jQuery sites
				var users;
				try {
					users = JSON.parse( json );
				} catch(e) {
					callback( new Error( "Could not parse users JSON" ));
					return;
				}
				client.getUsers( function( error, wp_users ){
					if (error) {
						callback(error);
					};
					client.operateOnUsers( users, wp_users, callback );
				} );
			} );
			// some streams may be paused when we receive them, like process.stdio
			stream.resume();
		} );
	};

	UserSync.methods = ['getUsers', 'getUser', 'getUserInfo', 'newUser', 'editUser', 'deleteUser'];

	/*	Adds the XML-RPC client methods for user management. Requires a plugin for
	 *	your WordPress site:
	 *
	 *	http://wordpress.org/extend/plugins/xml-rpc-modernization/
	 */
	UserSync.methods.forEach( function( method ){
		this[method] = function(){
			var args = [].slice.call( arguments );
			args.unshift( 'wp.' + method );
			this.client.authenticatedCall.apply( this.client, args );
		}
	}, UserSync.prototype );

	// Check that each method is available using client.listMethods
	UserSync.prototype.supported = function( callback ){
		this.client.listMethods( function( error, methods ){
			if (error) {
				callback( error, false );
			} else {
				var supported = UserSync.methods.every( function( method ){
					return methods.indexOf('wp.' + method) > -1;
				} );
				callback( error, supported );
			}
		} );
	};

	grunt.registerTask( 'wordpress-sync-users', function( fn ){
		var done = this.async(),
			client = grunt.helper( 'wordpress-client' ),
			sync = new UserSync(client),
			filePath = grunt.config( 'wordpress.dir' ) + '/users.json';
			var stream = fs.createReadStream( filePath );
			sync.run( stream, function( error, result ){
				if (error) {
					done( false, error );
				} else {
					done();
				}
			} );

	});

};



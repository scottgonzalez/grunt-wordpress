# grunt-wordpress

Grunt plugin for publishing content to WordPress

## Getting Started

Install this grunt plugin next to your project's
[grunt.js gruntfile](https://github.com/cowboy/grunt/blob/master/docs/getting_started.md)
with: `npm install grunt-wordpress`

Then add this line to your project's `grunt.js` gruntfile:

```javascript
grunt.loadNpmTasks( "grunt-wordpress" );
```

Finally, copy `grunt-wordpress.js` in to your WordPress install as a plugin.

If you have problems uploading resources, check the [Permissive Uploads](#permissive-uploads) section.

## API

For most projects, you should only need to specify the `wordpress` config
and use the `wordpress-deploy` task (or its alias `deploy`).

### Config

```javascript
grunt.initConfig({
	wordpress: {
		url: "wordpress.dev",
		username: "admin",
		password: "admin",
		dir: "dist"
	}
});
```

This works for a single deployment target. If you have multiple targets, you
can specify url, username and password for each:

```javascript
grunt.initConfig({
	wordpress: {
		dev: {
			url: "wordpress.dev",
			username: "admin",
			password: "admin",
		},
		live: {
			url: "wordpress.com",
			username: "admin",
			password: "admin",
		},
		_default: "dev",
		dir: "dist"
	}
});
```

If nothing is specified, the `_default` target is used. Override using the
target task:

	grunt target:live deploy

* `url`: The URL for the WordPress install.
  Can be a full URL, e.g., `http://wordpress.dev:123/some/path`
  or as short as just the host name.
  If the protocol is `https`, then a secure connection will be used.
* `username`: WordPress username.
* `password`: WordPress password.
* `dir`: Directory containing posts, taxonomies, and resources (see [Directory Structure](#directory-structure)).
* `_default`: The default deployment target, optional.

### Directory Structure

The `wordpress.dir` directory has the following structure:

```
dir
├── posts
│   └── <post_type>
│       └── <post_name>.html
├── resources
│   └── <file>.<ext>
└── taxonomies.json
```

The `posts` directory must only contain `<post_type>` directories.
The `<post_type>` directories must be named to exactly match a post type, e.g., `post` or `page`.
All custom post types are supported.

The `resources` directory is completely freeform.
Resources of any type will be uploaded based on the current directory structure.

### taxonomies.json

The `taxonomies.json` file defines all used taxonomy terms.
You can only manage terms, all taxonomies much already exist in WordPress.

```json
{
	"<taxonomy_name>": [
		{
			"name": "My Term",
			"description": "My term is awesome",
			"slug": "my-term"
		},
		{
			"name": "My Other Term",
			"slug": "my-other-term",
			"children": [
				{
					"name": "I'm a child term!",
					"slug": "hooray-for-children"
				}
			]
		}
	]
}
```

Slugs and names are required.

### Post Files

Post files must be HTML, containing the content of the post.
Post data can be specified as JSON in a `<script>` element at the top of the file.

```html
<script>{
	"title": "My Post",
	"termSlugs": {
		"<taxonomy_name>": [
			"<hierarchical_slug>"
		]
	}
}</script>
<p>I'm a post!</p>
```

The post type and parent are determined based on the [directory structure](#directory-structure).
`termSlugs` must match a hierarchical slug defined in [taxonomies.json](#taxonomiesjson).

### Tasks

#### wordpress-validate

Walks through the `wordpress.dir` directory and performs various validations, such as:

* Verifying that XML-RPC is enabled for the WordPress site.
* Verifying that the custom XML-RPC methods for grunt-wordpress are installed.
* Verifying the taxonomies and terms in `taxonomies.json`.
* Verifying that child-parent relationships for posts are valid.
* Verifying data for each post.

#### wordpress-sync

Synchronizes everything in `wordpress.dir` to the WordPress site.
This will create/edit/delete terms, posts, and resources.

*Note: `wordpress-validate` must run prior to `wordpress-sync`.*

#### wordpress-publish

Alias task for `wordpress-validate` and `wordpress-sync`.
This is useful if your original source content is already in the proper format,
or if you want to manually verify generated content between your custom build and publishing.

#### wordpress-deploy

Alias task for `build-wordpress` and `wordpress-publish`.
This is useful if you are generating content for use with `wordpess-sync`.
Simply create a `build-wordpress` task that populates the `wordpress.dir` directory
and your deployments will be as simple as `grunt wordpress-deploy`.

#### deploy

Alias task for `wordpress-deploy`.
Since most projects that use grunt-wordpress only have one deploy target (WordPress),
there is a built-in `deploy` task that just runs `wordpress-deploy`.
If your project has multiple deploy targets, you can simply re-alias the `deploy` task.

### Helpers

#### wordpress-recurse( path, callback, complete )

Walks through all files in `path` (asynchronous and in series ).

* `path`: The directory to walk through.
* `callbak` (`function( filepath, callback )`): Callback to invoke for each file.
  * `filepath`: Path to the current file.
  * `callback`: A callback to invoke after processing the file.
  Passing an error will stop the helper.
* `complete`: (`function( error )`): Callback to invoke after walking all files.

#### wordpress-client()

Gets a client for connecting to the WordPress site via XML-RPC.

#### wordpress-validate-xmlrpc-version( callback )

Verifies that the XML-RPC extensions for grunt-wordpress are installed in WordPress.

* `callback` (`function( error )`): Callback to invoke after verifying.

#### wordpress-validate-terms( path, callback )

* `path`: The path to the taxonomies JSON file.
* `callback` (`function( error )`): Callback to invoke after validating the terms.

#### wordpress-validate-posts( path, callback )

* `path`: The directory of posts to validate.
* `callback` (`function( error )`): Callback to invoke after validating the posts.

#### wordpress-get-postpaths( callback )

Gets the post paths for all existing posts in WordPress.
Post paths are the unique identifiers used by grunt-wordpress.

* `callback` (`function( error, postPaths )` ): Callback to invoke after getting the post paths.
  * `postPaths`: A hash of post paths to post ids and checksums.

#### wordpress-walk-posts( path, callback, complete )

Walks through all posts in `path` (asynchronous and in series).

* `path`: The directory to walk through.
* `callback` (`function( post, callback )`): Callback to invoke for each post.
  * `post`: An object containing the post content and metadata.
  * `callback`: A callback to invoke after processing the post.
  Passing an error will stop the helper.
* `complete` (`function( error )`): Callback to invoke after walking all posts.

If an error is encountered while parsing the post data or from a callback,
the helper will stop walking through posts and immediately invoke the `complete` callback with the error.

#### wordpress-parse-post( path )

Parses a file into a post object. See [Post Files](#post-files).

* `path`: The path of the file to parse.

#### wordpress-publish-post( post, callback )

Publishes a post to WordPress.
Automatically determines whether to publish a new post or edit an existing post.

* `post`: An object containing post data. See `wordpress-parse-post`.
* `callback` (`function( error, postId )`): Callback to invoke after publishing the post.
   * `postId`: Id of the post that was created or edited.

#### wordpress-delete-post( postId, postPath, callback )

Deletes a post from WordPress.

* `postId`: Id of the post to delete.
* `postPath`: Post path (unique identifier) of the post to delete.
* `callback`: (`function( error )`): Callback to invoke after deleting the post.

#### wordpress-sync-posts( path, termMap, callback )

Synchronizes all posts in `path` to the WordPress site.

* `path`: The directory containing posts to synchronize.
* `termMap`: Hash of hierarchical term slugs to term ids. See `wordpress-sync-terms`.
* `callback` (`function( error )`): Callback to invoke after synchronizing all posts.

#### wordpress-get-terms( callback )

Gets all terms that exist in WordPress, grouped by taxonomy.

* `callback` (`function( error, terms )`): Callback to invoke after getting the terms.
   * `terms`: Hash of terms, keyed by taxonomy and hierarchical slug.

#### wordpress-publish-term( term, callback )

Publishes a term to WordPress.
Automatically determines whether to publish a new term or edit an existing term.

* `term`: An object containing term data.
* `callback` (`function( error, termId )`): Callback to invoke after publishing the term.
   * `termId`: Id of the term that was created or edited.

#### wordpress-delete-term( term, callback )

Deletes a term from WordPress.

* `term`: An object containing term data.
* `callback` (`function( error )`): Callback to invoke after deleting the term.

#### wordpress-sync-terms( path, callback )

Synchronizes all terms in `path` to the WordPress site. See [taxonomies.json](#taxonomiesjson).

* `path`: The path of the taxonomies JSON file.
* `callback` (`function( error, termMap )`): Callback to invoke after synchronizing all terms.
   * `termMap`: Hash of hierarchical term slugs to term ids.
   Hierarchical term slugs are used for the `termSlugs` post data. See `wordpress-sync-posts`.

#### wordpress-get-resources( callback )

Gets the path and checksum for all existing resources in WordPress.

* `callback` (`function( error, resources )` ): Callback to invoke after getting the resources.
  * `resources`: A hash of resource paths to checksums.

#### wordpress-publish-resource( path, content, callback )

Publishes a resource to WordPress.
Overwrites existing resources with the same path.

* `path`: The path to publish the resource to (determiens URL).
* `content`: Base 64 encoded file content.
* `callback` (`function( error, checksum )`): Callback to invoke after publishing the resource.
  * `checksum`: Checksum of the encoded content.

#### wordpress-delete-resource( path, callback )

Deletes a resource from WordPress.

* `path`: The path of the resource to delete.
* `callback`: (`function( error, checksum )`): Callback to invoke after deleting the resource.
  * `checksum`: The checksum of the file that was deleted.
  If the file did not exist, the checksum will be empty.

#### wordpress-sync-resources( path, callback )

Synchronizes all resources in `path` to the WordPRess site.

* `path`: The directory containing resources to synchronize.
* `callback` (`function( error )`): Callback to invoke after synchronizing all resources.

## Permissive Uploads

Depending on what resources you're uploading, you may need to change some WordPress settings.
Here are a few settings that might help:

```php

// Disable more restrictive multisite upload settings.
remove_filter( 'upload_mimes', 'check_upload_mimes' );

// Give unfiltered upload ability to super admins.
define( 'ALLOW_UNFILTERED_UPLOADS', true );

// Allow additional file types.
add_filter( 'upload_mimes', function( $mimes ) {
	$mimes[ 'eot' ] = 'application/vnd.ms-fontobject';
	$mimes[ 'svg' ] = 'image/svg+xml';
	$mimes[ 'ttf' ] = 'application/x-font-ttf';
	$mimes[ 'woff' ] = 'application/font-woff';
	$mimes[ 'xml' ] = 'text/xml';
	$mimes[ 'php' ] = 'application/x-php';
	$mimes[ 'json' ] = 'application/json';
	return $mimes;
});

// Increase file size limit to 1GB.
add_filter( 'pre_site_option_fileupload_maxk', function() {
	return 1024 * 1024;
});
```

## License
Copyright 2012 Scott González
Licensed under the MIT license.

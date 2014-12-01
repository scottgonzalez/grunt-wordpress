# grunt-wordpress

Grunt plugin for publishing content to WordPress using [Gilded WordPress](https://github.com/scottgonzalez/grunt-wordpress).

Support this project by [donating on Gittip](https://www.gittip.com/scottgonzalez/).



## Getting Started

grunt-wordpress works just like any other [Grunt](http://gruntjs.com/) plugin. See the [Config](#config) section for details on setting up the Grunt tasks.

Make sure to copy `gilded-wordpress.php` in to your WordPress install as a plugin.

For most projects, you should only need to specify the `wordpress` config
and use the `wordpress-deploy` task (or its alias `deploy`).



## Config

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

* `url`: The URL for the WordPress install.
  Can be a full URL, e.g., `http://wordpress.dev:123/some/path`
  or as short as just the host name.
  If the protocol is `https`, then a secure connection will be used.
* `host` (optional): The actual host to connect to if different from the URL, e.g., when deploying to a local server behind a firewall.
* `username`: WordPress username.
* `password`: WordPress password.
* `dir`: Directory containing posts, taxonomies, and resources.
  * See the [Gilded WordPress documentation](https://github.com/scottgonzalez/gilded-wordpress#directory-structure) for details on the directory structure and file formats.



## Tasks

### wordpress-validate

Walks through the `wordpress.dir` directory and performs various validations, such as:

* Verifying that XML-RPC is enabled for the WordPress site.
* Verifying that the custom XML-RPC methods for grunt-wordpress are installed.
* Verifying the taxonomies and terms in `taxonomies.json`.
* Verifying that child-parent relationships for posts are valid.
* Verifying data for each post.

### wordpress-sync

Synchronizes everything in `wordpress.dir` to the WordPress site.
This will create/edit/delete terms, posts, and resources.

*Note: `wordpress-validate` must run prior to `wordpress-sync`.*

### wordpress-publish

Alias task for `wordpress-validate` and `wordpress-sync`.
This is useful if your original source content is already in the proper format,
or if you want to manually verify generated content between your custom build and publishing.

### wordpress-deploy

Alias task for `build-wordpress` and `wordpress-publish`.
This is useful if you are generating content for use with `wordpess-sync`.
Simply create a `build-wordpress` task that populates the `wordpress.dir` directory
and your deployments will be as simple as `grunt wordpress-deploy`.

### deploy

Alias task for `wordpress-deploy`.
Since most projects that use grunt-wordpress only have one deploy target (WordPress),
there is a built-in `deploy` task that just runs `wordpress-deploy`.
If your project has multiple deploy targets, you can simply re-alias the `deploy` task.



## Permissive Uploads

Depending on what resources you're uploading, you may need to change some WordPress settings. See the [Gilded WordPress documentation](https://github.com/scottgonzalez/grunt-wordpress#permissive-uploads) for some settings that might help.



## License

Copyright 2014 Scott González. Released under the terms of the MIT license.

---

Support this project by [donating on Gittip](https://www.gittip.com/scottgonzalez/).

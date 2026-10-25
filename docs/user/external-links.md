# Open some links in a different app

The desktop app opens external links in your default browser. If certain links must open elsewhere,
for example a corporate login that only works in a managed browser, add rules to
`~/.t3/userdata/external-link-rules.json` on the machine running the desktop app:

```json
{
  "externalLinkRules": [
    {
      "match": "https://login.example.com/*redirect_uri=https%3A%2F%2Fauth.example.com*",
      "command": ["open", "-b", "com.example.managed-browser", "{url}"]
    }
  ]
}
```

`match` is compared against the full URL, including the query string. `*` matches any run of
characters, and everything else is literal. `command` is the program to run and its arguments.
`{url}` is replaced with the link; if no argument contains it, the link is appended as the last
argument.

The first matching rule wins. Links that match no rule, and links whose command fails to start or
exits with an error, open in the default browser. Edits take effect on the next link, without
restarting the app. The file is optional and this feature is off until you create it.

The desktop app runs the configured command as you, so only add rules you wrote yourself.

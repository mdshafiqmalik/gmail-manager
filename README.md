# Gmail Manager (Static Web App)

A browser-only Gmail management interface. It can be hosted as a static website (for example, GitHub Pages). Each visitor connects their own Google account through Google Identity Services and the Gmail API.

## Features

- Google OAuth connection using a **Web application OAuth Client ID**.
- Inbox, sent, drafts, starred, promotions, social, unread, spam and trash views.
- Gmail search syntax, quick filters, adjustable page size and pagination.
- Sender-domain wildcard shortcut: `*@linkedin.com` or `from:*@linkedin.com` is translated into Gmail sender search; combine it with filters such as `older_than:1y`.
- Read message details as text, view message headers and download message attachments.
- Sender analysis (scan up to 10,000 messages per run), ranked sender list and CSV export.
- Bulk archive, mark read/unread, star/unstar, report spam, move to Trash and restore from Trash.
- Create custom labels and apply labels to selected messages.
- Send a plain-text email.
- Preview a Gmail search count before the “Trash all matching” action. The app requires the user to type `TRASH` before it changes messages.
- No server, database, build step or Node.js runtime is required.

This is a focused mailbox-management app, not a complete replacement for every Gmail feature. For safety, deletion means moving messages to Gmail Trash; the app does not permanently delete messages.

## Google Cloud setup

### 1. Create a Google Cloud project and enable Gmail API

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Open **APIs & Services → Library**, find **Gmail API**, and enable it.
4. Open **Google Auth Platform** and configure the app information, audience and data access.

### 2. Configure OAuth consent

1. Choose **External** for a public app used by people outside your organization.
2. During development, leave the app in **Testing** and add each test Google account under **Audience → Test users**.
3. Add the app name, support email, developer contact email, homepage URL, privacy-policy URL and terms URL.
4. Declare the scope `https://www.googleapis.com/auth/gmail.modify` under **Data Access**.
5. Before making this available to the general public, complete Google's OAuth verification for the requested Gmail scope and publish the OAuth app. An app left in Testing is limited to accounts listed as test users.

Google classifies `gmail.modify` as a **restricted Gmail scope**. Google may require verification before a public app can serve general users. Review the latest [Gmail API scope guidance](https://developers.google.com/workspace/gmail/api/auth/scopes) and [OAuth verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview). Do not tell users that the application is verified until Google has approved it.

### 3. Create the OAuth Client ID

1. In **Google Auth Platform → Clients**, create an OAuth client.
2. Select **Web application**.
3. Add the exact website origin under **Authorized JavaScript origins**. Examples:
   - Local test: `http://localhost:8000`
   - GitHub Pages: `https://YOUR-USERNAME.github.io`
   - Custom domain: `https://mail.example.com`
4. A redirect URI is not needed for this browser token flow.
5. Copy the **Client ID**. Do not create or publish a client secret for this static website.

### 4. Add the Client ID

For a deployed public site, edit `config.js`:

```js
window.GMAIL_MANAGER_CONFIG = {
  googleClientId: "YOUR_WEB_APPLICATION_CLIENT_ID.apps.googleusercontent.com"
};
```

The Client ID is public and is designed to be used in browser applications. **Never put a client secret, refresh token, access token, `credentials.json` or `token.json` in this repository.** Visitors do not need to enter their own Client ID once you have configured yours in `config.js`.

Alternatively, leave `config.js` blank and let each person enter their own Client ID in the connection screen. The app saves only that Client ID in that browser's local storage.

## Run locally

From this directory:

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Add `http://localhost:8000` to the OAuth client's Authorized JavaScript origins. Do not open `index.html` directly using a `file://` URL.

## Publish with GitHub Pages

1. Create a GitHub repository, for example `gmail-manager`.
2. Upload **all files in this folder** to the repository root (not the parent ZIP folder).
3. Put your OAuth Client ID into `config.js`.
4. Open repository **Settings → Pages**.
5. Under Build and deployment, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
6. Wait for GitHub Pages to publish the site. Add the resulting origin (for example `https://YOUR-USERNAME.github.io`) to the OAuth client's Authorized JavaScript origins.
7. Set the homepage, privacy policy and terms URLs in the Google OAuth consent configuration.

## Sender-domain wildcard search

The search box accepts a convenience pattern such as `*@linkedin.com` or `from:*@linkedin.com`. The app converts it to Gmail's supported `from:linkedin.com` query before calling the Gmail API. You can combine it with normal Gmail operators, for example:

```text
*@linkedin.com older_than:1y
from:*@linkedin.com category:updates
```

Gmail's search language does not implement general-purpose `*` wildcards. This app supports the sender-domain shortcut only; Gmail evaluates the resulting `from:domain` query using its own sender search behavior.

## Security and data handling

- The Gmail API is called directly from the visitor's browser over HTTPS.
- The OAuth access token is kept in JavaScript memory and is not written to local storage, cookies or a server by this application. Reloading the page clears it.
- The Client ID may be saved in local storage for convenience. It is not a secret.
- Message data, sender analysis and attachments are processed in the browser. Sender exports are downloaded by the user.
- The app does not include a backend, database, analytics SDK or application-side email storage.
- Google and the static hosting provider operate their own services under their own policies. See the linked privacy policy.
- The scope requested is `gmail.modify`, which allows reading and modifying mailbox messages and sending mail. This app does not request the broad `https://mail.google.com/` scope and does not implement permanent deletion.
- Users can disconnect or revoke access from Settings or from their Google Account security settings.

Before public launch, replace the contact placeholder in `privacy.html` with a real monitored contact address and make sure the policy matches the exact deployed behavior and any hosting or analytics services you add.

## Troubleshooting

- **Access blocked / app not verified:** During development, add your Google account as a test user. To allow general public users, complete Google's verification process for the Gmail scope and publish the OAuth app.
- **origin_mismatch:** Add the exact scheme + host + port of the current site to Authorized JavaScript origins. GitHub Pages origin does not include the repository path.
- **Gmail API has not been used / disabled:** Enable Gmail API in the same Cloud project as the OAuth client.
- **Token expired / 401:** Click Connect Google again. Access tokens are short-lived.
- **Blank sign-in / GIS failed to load:** Check network access to `accounts.google.com` and reload the website.

## API references

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Gmail API messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
- [Gmail API messages.batchModify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify)
- [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

const readline = require("readline");
const { google } = require("googleapis");
const tokenStore = require("./token-store")

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {string} token_path  Path to token json file.
 */
async function authorize(credentials, token_path) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  // Check if we have previously stored a token.
  try {
    oAuth2Client.setCredentials(tokenStore.get(token_path));
    return oAuth2Client;
  } catch (error) {
    return await get_new_token(oAuth2Client, token_path);
  }
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {string} token_path  Path to token json file.
 * @return {Promise} The promise for the authorized client.
 */
async function get_new_token(oAuth2Client, token_path) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve, reject) => {
    rl.question("Enter the code from that page here: ", async code => {
      rl.close();
      oAuth2Client.getToken(code, function (err, token) {
        if (err) {
          reject(err);
        } else {
          oAuth2Client.setCredentials(token);
          tokenStore.store(token, token_path)
          resolve(oAuth2Client);
        }
      });
    });
  });
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function list_labels(gmail, oauth2Client) {
  try {
    const labels = await new Promise((resolve, reject) => {
      gmail.users.labels.list(
        {
          userId: "me",
          auth: oauth2Client
        },
        function (err, res) {
          if (err) {
            reject(err);
          } else {
            const labels = res.data.labels;
            resolve(labels);
          }
        }
      );
    });
    return labels;
  } catch (err) {
    console.log("The API returned an error: " + err);
    throw err;
  }
}

/**
 * Retrieve Messages in user's mailbox matching query.
 *
 * @param  {String} userId User's email address. The special value 'me'
 * can be used to indicate the authenticated user.
 * @param  {String} query String used to filter the Messages listed.
 */
async function list_messages(gmail, oauth2Client, query, labelIds) {
  const messages = await new Promise((resolve, reject) => {
    gmail.users.messages.list(
      {
        userId: "me",
        q: query,
        auth: oauth2Client,
        labelIds: labelIds
      },
      async function (err, res) {
        if (err) {
          reject(err);
        } else {
          let result = res.data.messages || [];
          let { nextPageToken } = res.data;
          while (nextPageToken) {
            const resp = await new Promise((resolve, reject) => {
              gmail.users.messages.list(
                {
                  userId: "me",
                  q: query,
                  auth: oauth2Client,
                  labelIds: labelIds,
                  pageToken: nextPageToken
                },
                function (err, res) {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(res);
                  }
                }
              );
            });
            result = result.concat(resp.data.messages);
            nextPageToken = resp.data.nextPageToken;
          }
          resolve(result);
        }
      }
    );
  });
  let result = messages || [];
  return result;
}

/**
 * Get the recent email from your Gmail account
 *
 * @param {google.auth.OAuth2} oauth2Client An authorized OAuth2 client.
 * @param {String} query String used to filter the Messages listed.
 */
async function get_recent_email(gmail, oauth2Client, query = "", label = "INBOX") {
  try {
    const labels = await list_labels(gmail, oauth2Client);
    const inbox_label_id = [labels.find(l => l.name === label).id];
    const messages = await list_messages(
      gmail,
      oauth2Client,
      query,
      inbox_label_id
    );
    let promises = [];
    for (let message of messages) {
      promises.push(
        new Promise((resolve, reject) => {
          gmail.users.messages.get(
            {
              auth: oauth2Client,
              userId: "me",
              id: message.id,
              format: "full"
            },
            function (err, res) {
              if (err) {
                reject(err);
              } else {
                resolve(res);
              }
            }
          );
        })
      );
    }
    const results = await Promise.all(promises);
    return results.map(r => r.data);
  } catch (error) {
    console.log("Error when getting recent emails: " + error);
    throw error;
  }
}

module.exports = {
  authorize,
  get_recent_email
};

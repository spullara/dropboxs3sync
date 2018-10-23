const AWS = require('aws-sdk');
const db = new AWS.DynamoDB({region: 'us-west-2'});
const sns = new AWS.SNS({region: 'us-west-2'});
const s3 = new AWS.S3({region: 'us-west-2'});
const mime = require('mime-types');

const https = require('https');
const {promisify} = require('util');
// define a custom promisified version of `http.get()`
https.get[promisify.custom] = (options) => new Promise(resolve => {
    https.get(options, resolve)
});
const httpsGetAsync = promisify(https.get);

const fetch = require('isomorphic-fetch');
const Dropbox = require('dropbox').Dropbox;

exports.handler = async (event, context, callback) => {
    const config = await db.getItem({TableName: "dropbox_s3_sync", Key: {env: {S: "production"}}}).promise();
    const dbx = new Dropbox({accessToken: config.Item.access_token.S, fetch: fetch});

    if (event.httpMethod === "GET") {
        const challenge = event.queryStringParameters.challenge;
        console.log("Verified: " + challenge);
        callback(null, {
            "statusCode": 200,
            "body": challenge,
            "headers": {
                "Content-Type": "text/plain",
                "X-Content-Type-Options": "nosniff"
            }
        });
    } else {
        console.log("Getting cursor from config: " + JSON.stringify(config));
        let cursor = null;
        if (config.Item.cursor) {
            cursor = config.Item.cursor.S;
        }

        let hasMore = true;
        while (hasMore) {
            let result;
            if (cursor) {
                console.log("Continuing at cursor: " + cursor);
                result = await dbx.filesListFolderContinue({cursor: cursor});
            } else {
                console.log("No cursor, getting all in directory");
                result = await dbx.filesListFolder({path: "/franklinlionsclub/", recursive: true})
            }

            await result.entries.forEach(async entry => {
                console.log(JSON.stringify(entry));

                const params = {
                    Message: JSON.stringify(entry),
                    TopicArn: 'arn:aws:sns:us-west-2:178871584816:dropbox_s3_copy_file'
                };
                console.log(JSON.stringify(await sns.publish(params).promise()));
            });

            hasMore = result.has_more;
            cursor = result.cursor;
            console.log("Updating cursor: " + cursor);
            await db.updateItem({
                TableName: "dropbox_s3_sync",
                Key: {env: {S: "production"}},
                ExpressionAttributeValues: {
                    ":c": {S: cursor}
                },
                ExpressionAttributeNames: {
                    "#c": "cursor"
                },
                UpdateExpression: "set #c = :c",
                ReturnValues: "ALL_NEW"
            }).promise();
        }
        callback(null, {
            "statusCode": 200,
            "body": ""
        });
    }
};

exports.copyfile = async (event, context, callback) => {
    const config = await db.getItem({TableName: "dropbox_s3_sync", Key: {env: {S: "production"}}}).promise();
    const dbx = new Dropbox({accessToken: config.Item.access_token.S, fetch: fetch});

    try {
        await event.Records.forEach(async record => {
            const message = JSON.parse(record.Sns.Message);
            const name = message.path_display.replace("/franklinlionsclub/", "");
            console.log(JSON.stringify(message));

            if (message[".tag"] === "file") {
                const tmpLink = await dbx.filesGetTemporaryLink({path: message.path_display});
                const stream = await httpsGetAsync(tmpLink.link);
                const upload = await s3.putObject({
                    Body: stream,
                    Bucket: "franklinlionsclub.com",
                    Key: name,
                    ContentLength: message.size,
                    ContentType: mime.lookup(name)
                }).promise();
                console.log("Uploaded: " + name);
            } else if (message[".tag"] === "deleted") {
                const deleted = await s3.deleteObject({
                    Bucket: "franklinlionsclub.com",
                    Key: name
                }).promise();
                console.log("Deleted: " + name);
            } else {
                console.log("Failed to process: " + message[".tag"]);
            }
        });
        callback(null, {
            "status": 200,
            "body": ""
        });
    } catch (err) {
        callback(err);
    }
};
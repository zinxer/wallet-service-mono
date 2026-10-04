const lib = require('./lib.js')
const log = require("./console_log.js")
const SQL = lib.SQL

var creds = new lib.awssdk.Credentials(lib.CONFIG.AWS.APIKEY, lib.CONFIG.AWS.SECRETKEY);
var config = new lib.awssdk.Config({
    credentials: creds, region: 'ap-southeast-1'
});

const s3 = new lib.awssdk.S3(config);
const bucketName = lib.CONFIG.AWS.BUCKET_NAME;

async function getKeys(prefix = '', keys = []){

    // const allKeys = [];
    // await getKeys(bucketName, prefix, allKeys);
    // return allKeys.length;

    let params = {
        Bucket: bucketName,
        Prefix: prefix
    };

    let response = await s3.listObjectsV2(params).promise();
    response.Contents.forEach(obj => keys.push(obj.Key));

    if (response.IsTruncated) {
        const newParams = Object.assign({}, params);
        newParams.ContinuationToken = response.NextContinuationToken;
        await getKeys(newParams, keys); // RECURSIVE CALL
    }

    return keys;
}

async function getFile(key){

    var params = {
        Bucket: bucketName, 
        Key: key
    };

    let response = await s3.getObject(params).promise();

    return response;
}

async function uploadToS3 (filePath, fileName, file, mimeType) {    

    let params = {
      Bucket: bucketName,
      Key: filePath + fileName,
      Body: file,
      ContentType: mimeType
    };

    try{
        let result = await s3.upload(params).promise();
        return result;
    }catch(err){
        console.log(err);
        throw new Error(err);
    }
}

module.exports = {
    getKeys,
    getFile,
    uploadToS3
}
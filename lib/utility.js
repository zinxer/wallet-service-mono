const lib = require('./lib.js')
const log = require("./console_log.js")
const SQL = lib.SQL

const PADDING = [
    [16, 16, 16, 16,
      16, 16, 16, 16,
      16, 16, 16, 16,
      16, 16, 16, 16],
  
    [15, 15, 15, 15,
      15, 15, 15, 15,
      15, 15, 15, 15,
      15, 15, 15],
  
    [14, 14, 14, 14,
      14, 14, 14, 14,
      14, 14, 14, 14,
      14, 14],
  
    [13, 13, 13, 13,
      13, 13, 13, 13,
      13, 13, 13, 13,
      13],
  
    [12, 12, 12, 12,
      12, 12, 12, 12,
      12, 12, 12, 12],
  
    [11, 11, 11, 11,
      11, 11, 11, 11,
      11, 11, 11],
  
    [10, 10, 10, 10,
      10, 10, 10, 10,
      10, 10],
  
    [9, 9, 9, 9,
      9, 9, 9, 9,
      9],
  
    [8, 8, 8, 8,
      8, 8, 8, 8],
  
    [7, 7, 7, 7,
      7, 7, 7],
  
    [6, 6, 6, 6,
      6, 6],
  
    [5, 5, 5, 5,
      5],
  
    [4, 4, 4, 4],
  
    [3, 3, 3],
  
    [2, 2],
  
    [1]
  ];

async function delay(t, val) {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve(val);
    }, t);
  });
} //end of delay

async function validate2fa(merchantId, code2fa) {
    
    let userObj = null;
    let result = false;
    
    await SQL.users.findOne({
        where: {
            merchantId: merchantId,
            isActive: true
        }
    }).then((user) => {
        userObj = user
    }).catch((e) => {
        console.log(e);
    })

    if (userObj == null) return false;
    let type = (userObj.otp_secret == undefined) ? 'EMAIL' : 'OTP';
    
    if(!code2fa) return false;
   
    if(type == 'EMAIL'){

        if(userObj.code2fa == null) return false;

        result = (code2fa == userObj.code2fa);

        //clear code2fa, so it's not used again.
        if(result){
          userObj.update({
            code2fa: null,
            code2faEpoch: null
          });
        }
        
    }else{
        
        let decryptedSecret = await aesDecrypt(userObj.otp_secret);
        
        result = await lib.otp.authenticator.check(code2fa, decryptedSecret);
        
        if(result.err){
            console.log(result.err);
            return false;
        }
    }

    return result;

} //end of validate2fa

async function aesEncrypt(plainText, initVector = null, mode = 'CBC') {
    
    // Bits used will depend on key length
    // Key should be 32 bytes so that 256bit encryption is used 
    
    // Extract key from config and convert into array of numbers
    let keyString = lib.CONFIG.AES.KEY;
    let key = keyString.split(", ");
    key = key.map(x => Number(x));

    // Extract default Initial Vector from config and convert into array of numbers
    if(initVector == null){
        let initVectorString = lib.CONFIG.AES.INITIAL_VECTOR;
        initVector = initVectorString.split(", ");
        initVector = initVector.map(x => Number(x));
    }
    
    // The initialization vector (must be 16 bytes)
    if(initVector.length != 16){
        throw new Error("Initialization Vector must be 16 bytes");
    }

    let encryptedBytes = null;

    // Convert text to bytes (text must be a multiple of 16 bytes)
    let plainTextBytes = await lib.aes.utils.utf8.toBytes(plainText);
    
    switch(mode){
        case 'CTR':
            let aesCtr = new lib.aes.ModeOfOperation.ctr(key, initVector);
            encryptedBytes = await aesCtr.encrypt(plainTextBytes);            
            break;
            
        case 'CBC':

            // CBC Method Requires plaintext to be mutiple of 16 bytes
            let padding = PADDING[(plainTextBytes.byteLength % 16) || 0];
            let paddedPlainTextBytes = new Uint8Array(plainTextBytes.byteLength + padding.length);

            paddedPlainTextBytes.set(plainTextBytes);
            paddedPlainTextBytes.set(padding, plainTextBytes.byteLength); 

            let aesCbc = new lib.aes.ModeOfOperation.cbc(key, initVector);
            encryptedBytes = await aesCbc.encrypt(paddedPlainTextBytes);
            break;
    }

    // Convert to hex for storage
    let encryptedHex = await lib.aes.utils.hex.fromBytes(encryptedBytes);
    
    return encryptedHex;

} //end of aesEncrypt

async function aesDecrypt(encryptedHex, initVector = null, mode = 'CBC') {

    // Bits used will depend on key length
    // Key should be 32 bytes so that 256bit encryption is used 

    // Extract key from config and convert into array of numbers
    let keyString = lib.CONFIG.AES.KEY;
    let key = keyString.split(", ");
    key = key.map(x => Number(x));

    // Extract default Initial Vector from config and convert into array of numbers
    if(initVector == null){
        let initVectorString = lib.CONFIG.AES.INITIAL_VECTOR;
        initVector = initVectorString.split(", ");
        initVector = initVector.map(x => Number(x));
    }
    
    // The initialization vector (must be 16 bytes)
    if(initVector.length != 16){
        throw new Error("Initialization Vector must be 16 bytes");
    }

    let decryptedBytes = null;

    // Convert hex back to bytes for decryption
    encryptedBytes = await lib.aes.utils.hex.toBytes(encryptedHex);
    
    switch(mode){
        case 'CTR':
            let aesCtr = new lib.aes.ModeOfOperation.ctr(key, initVector);
            decryptedBytes = await aesCtr.decrypt(encryptedBytes);           
            break;
            
        case 'CBC':
            
            let aesCbc = new lib.aes.ModeOfOperation.cbc(key, initVector);
            decryptedBytes = await aesCbc.decrypt(encryptedBytes);

            decryptedBytes = decryptedBytes.subarray(0, decryptedBytes.byteLength - decryptedBytes[decryptedBytes.byteLength - 1]);
            break;
    }

    // Convert our bytes back into text
    let decryptedText = await lib.aes.utils.utf8.fromBytes(decryptedBytes);

    return decryptedText;

} //end of aesDecrypt

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

module.exports = {
	delay,
	validate2fa,
	aesEncrypt,
	aesDecrypt,
	asyncForEach
}
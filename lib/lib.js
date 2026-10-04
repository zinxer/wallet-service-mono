//EXPORT
module.exports.CONFIG = require("../usdt-wallet-server.js")
module.exports.SQL = require("../db/sql.js")

module.exports.sequelize = require("sequelize")
module.exports.request = require("request")
module.exports.requestpn = require("request-promise-native")
module.exports.fs = require("fs")
module.exports.bitcoin = require("bitcoinjs-lib")
module.exports.expressJWT = require("express-jwt")
module.exports.jwt = require("jsonwebtoken")
module.exports.createHmac = require("create-hmac")
module.exports.md5 = require("md5")
module.exports.nodemailer = require("nodemailer")
module.exports.randomize = require("randomatic")
module.exports.bcrypt = require("bcrypt")
module.exports.uniqid = require("uniqid")
module.exports.rateLimit = require("express-rate-limit")
module.exports.md5File = require("md5-file")
module.exports.csv = require("fast-csv")
module.exports.walletValid = require("wallet-address-validator")
module.exports.otp = require('otplib')
module.exports.juice = require('juice')
module.exports.qrcode = require('qrcode')
module.exports.aes = require('aes-js')
module.exports.web3  = require('web3')
module.exports.abiDecoder  = require('abi-decoder')
module.exports.awssdk = require('aws-sdk')

//Sequelize Operators
module.exports.Op = require("sequelize").Op

// Wallet Object
const WalletClass = require('./classes/Wallet.class.js');
module.exports.walletObj = new WalletClass();

// Web Socket
const WebSocketClass = require("./webSocket.js");
module.exports.webSocket = new WebSocketClass();

//Source
module.exports.bot = require("./bot.js");


// Runtime configuration. All deployment-specific values come from environment
// variables (see .env.example). Variables are prefixed DEV_ or PROD_ and selected
// by the run argument: `node usdt-wallet-server.js dev|prod`.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BRAND_NAME = process.env.BRAND_NAME || 'Wallet Service';

function build(env, runName, overrides) {
    const e = (name) => process.env[env + '_' + name];
    const P = e('PREFIX');
    const emailBlock = (kind, subject) => ({
        HOST: e('EMAIL_' + kind + '_HOST'),
        PORT: e('EMAIL_' + kind + '_PORT'),
        FROM: '"' + BRAND_NAME + '" <' + (process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com') + '>',
        SUBJECT: BRAND_NAME + ' ' + subject,
        ADDRESS: process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com',
        PASSWORD: e('EMAIL_' + kind + '_PASSWORD')
    });
    return Object.assign({
        BRAND_NAME: BRAND_NAME,
        MAIN: e('MAIN_URL'),
        DOMAIN: e('MAIN_DOMAIN'),
        STATUS_DIR: "/verification/",
        PORT: e('MAIN_PORT'),
        RUN: runName,
        PREFIX: P,
        APILOGPATH: process.env.APILOGPATH || ("/tmp/api_query-" + env.toLowerCase() + ".log"),
        DB: {
            SCHEMA: e('DB_SCHEMA'),
            HOST: e('DB_HOST'),
            USER: e('DB_USER'),
            PASSWORD: e('DB_PASSWORD'),
            SSL_CA_PATH: e('DB_SSL_CA_PATH') // optional, enables TLS verification
        },
        USDT_NODE: {
            NETWORK: e('USDT_NODE_NETWORK'),
            HOST: e('USDT_NODE_HOST'),
            PORT: e('USDT_NODE_PORT'),
            USER: e('USDT_NODE_USER'),
            PASSWORD: e('USDT_NODE_PASSWORD')
        },
        ETH_NODE: {
            NETWORK: e('ETH_NODE_NETWORK')
        },
        WALLET_ADDR: {
            FUNDER: e('WALLET_ADDR_FUNDER'),
            WITHDRAW: e('WALLET_ADDR_WITHDRAW'),
            DESTADDR: e('WALLET_ADDR_DESTADDR')
        },
        ETH_WALLET_ADDR: {
            WITHDRAW: e('ETH_WALLET_ADDR_WITHDRAW'),
            COLD: e('ETH_WALLET_ADDR_COLD')
        },
        ETH_WALLET_PASSWORD: e('ETH_WALLET_PASSWORD'),
        RECEIVE_CONF_NUM: 1,
        FORWARD_CONF_NUM: 1,
        CMC_CRED: e('CMC_CRED'),
        MINING_FEE: "halfHourFee",
        MIN_USDT_CREATE_TX_AMOUNT: 3, //min amount required for merchant createTx
        MIN_USDT_AMOUNT: 3, //If detected, will forward usdt
        MIN_USDT_WITHDRAW_AMOUNT: 20, // Minimum withdrawal amount.
        MIN_BTC_CONSOLIDATE: 0.0025, //Minimum amount to consolidate btc in wallet
        MIN_HOT_WALLET_BTCUSD: 5, //in USD rate
        MIN_HOT_WALLET_USDT: 0.5,
        MAX_SEND_FEE: 3, //We would not allow forward tx if fee is above this USD value
        EMAIL_2FA: emailBlock('2FA', '2FA Verification'),
        EMAIL_VERILINK: emailBlock('VERILINK', 'Email Verification'),
        EMAIL_PASSRESET: emailBlock('PASSRESET', 'Password Reset'),
        SALT_ROUNDS: 10,
        ENDPOINTS: {
            SECRET: e('ENDPOINTS_SECRET'),
            PUBLIC_URLS: [
                P + "/merchant/register",
                P + "/merchant/login",
                P + "/merchant/login/forgot",
                P + "/merchant/reset/info",
                P + "/merchant/reset/verify",
                P + "/merchant/verify",
                P + "/merchant/reset/password",
                P + "/test/ipn_listener"
            ],
            PRIVATE_URLS: [
                P + "/merchant/orders",
                P + "/merchant/withdraw/check",
                P + "/merchant/withdraw",
                P + "/merchant/withdraw/bulk/check",
                P + "/merchant/withdraw/bulk",
                P + "/merchant/2fa/email/send",
                P + "/merchant/2fa/otp/gen",
                P + "/merchant/2fa/otp/setup",
                P + "/merchant/2fa/otp/delete",
                P + "/merchant/2fa/validate",
                P + "/merchant/verification",
                P + "/merchant/info",
                P + "/merchant/addresses",
                P + "/merchant/api",
                P + "/merchant/api/status",
                P + "/merchant/ipn",
                P + "/merchant/ipn/handle",
                P + "/merchant/ipn/history",
                P + "/merchant/ipn/resend",
                P + "/merchant/ipn/sample",
                P + "/merchant/transaction/toggle",
                P + "/merchant/deposits",
                P + "/merchant/deposits/gen",
                P + "/merchant/deposits/address",
                P + "/merchant/password",
                P + "/merchant/chart/orders",
                P + "/merchant/tokens",
                P + "/merchant/kyc",
                P + "/merchant/whitelistips",
                P + "/admin/user",
                P + "/admin/user/register",
                P + "/admin/withdraw/verify",
                P + "/admin/withdraw/total",
                P + "/admin/kyc"
            ],
            MERCHANT_URLS: [
                P + "/transaction/create",
                P + "/transaction/info",
                P + "/transaction/pending",
                P + "/ipn/validate",
                P + "/networkfee",
                P + "/transaction/bulkWithdraw",
                P + "/info"
            ],
            KYC_PATHS: [
                "/merchant/api"
            ]
        },
        TELEGRAM: {
            'STATUS': true,
            'GROUP_SYSTEM': e('TELEGRAM_GROUP_SYSTEM'),
            'GROUP_MONITOR': e('TELEGRAM_GROUP_MONITOR'),
            'GROUP_ADMIN': e('TELEGRAM_GROUP_ADMIN'),
            'KEY': e('TELEGRAM_KEY')
        },
        ETHERSCAN: {
            APIKEY: e('ETHERSCAN_APIKEY')
        },
        IPDATA: {
            APIKEY: e('IPDATA_APIKEY')
        },
        AWS: {
            APIKEY: e('AWS_APIKEY'),
            SECRETKEY: e('AWS_SECRETKEY'),
            BUCKET_NAME: e('AWS_BUCKET_NAME')
        },
        AES: {
            'KEY': e('AES_KEY'),
            'INITIAL_VECTOR': e('AES_INITIAL_VECTOR')
        },
        WITHDRAWAL_VERIFY_AMT: e('WITHDRAWAL_VERIFY_AMT'),
        EXPIRE_CODE_SEC: 600 //10 mins
    }, overrides);
}

module.exports = {
    dev: build('DEV', 'development', {}),
    prod: build('PROD', 'production', { MIN_USDT_WITHDRAW_AMOUNT: 200, MIN_HOT_WALLET_USDT: 0 })
};

const lib = require('../lib/lib.js')
const sequelize = require('sequelize')
const fs = require('fs');
// Optional CA bundle for TLS database connections (set DB_SSL_CA_PATH).
const dbCaPath = lib.CONFIG.DB.SSL_CA_PATH;
const dbCa = dbCaPath ? fs.readFileSync(dbCaPath) : null;

var sequelize_config = {
    host: lib.CONFIG.DB.HOST,
    logging: false,
    maxConcurrentQueries: 100,
    dialect: 'mysql',
    dialectOptions: {
        ssl: {
            rejectUnauthorized: true,
            ca: [dbCa]
        }
    },
    pool: {
        maxConnections: 10,
        maxIdleTime: 15
    },
    language: 'en'
}

if (lib.CONFIG.DB.HOST == 'localhost' || !dbCa) {
    sequelize_config = {
        host: lib.CONFIG.DB.HOST,
        logging: false,
        maxConcurrentQueries: 100,
        dialect: 'mysql',
        pool: {
            maxConnections: 10,
            maxIdleTime: 15
        },
        language: 'en'
    }
}

const db = new sequelize(lib.CONFIG.DB.SCHEMA, lib.CONFIG.DB.USER, lib.CONFIG.DB.PASSWORD, sequelize_config)

const api_keys = db.define('api_keys', {
    id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    isActive: sequelize.BOOLEAN,
    merchantId: sequelize.STRING,
    label: sequelize.STRING,
    apiKey: sequelize.STRING,
    secretKey: sequelize.STRING,
    epoch: sequelize.INTEGER,
    createdAt: sequelize.DATE,
    updatedAt: sequelize.DATE
})

const whitelisted_ips = db.define('whitelisted_ips', {
    wip_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    wip_merchantId: sequelize.STRING,
    wip_apiKey: sequelize.STRING,
    wip_ip: sequelize.STRING,
    wip_lastAccess: sequelize.INTEGER,
    wip_createdEpoch: sequelize.INTEGER,
    wip_createdAt: sequelize.DATE
}, {
    timestamps: false
})

const usdt_tx_batches = db.define('usdt_tx_batches', {
    id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    merchantId: sequelize.STRING,
    orderId: sequelize.STRING,
    createdEpoch: sequelize.INTEGER,
    node: sequelize.STRING,
    token: sequelize.STRING,
    amount: sequelize.DECIMAL(17, 8), //supports up to 100M and 8 decimals
    confirmedEpoch: sequelize.INTEGER,
    paymentAddr: sequelize.STRING,
    status: sequelize.STRING,
    ipn_status: sequelize.STRING,
    isProcessing: sequelize.BOOLEAN,
    createdByApiKey: sequelize.STRING
})

const usdt_clear_batches = db.define('usdt_clear_batches', {
    id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    merchantId: sequelize.STRING,
    orderId: sequelize.STRING,
    createdEpoch: sequelize.INTEGER,
    confirmedEpoch: sequelize.INTEGER,
    node: sequelize.STRING,
    token: sequelize.STRING,
    amount: sequelize.DECIMAL(17, 8), //supports up to 100M and 8 decimals
    fee: sequelize.DECIMAL(6, 4),
    paymentAddr: sequelize.STRING,
    destinationAddr: sequelize.STRING,
    funderAddr: sequelize.STRING,
    status: sequelize.STRING,
    txid: sequelize.STRING,
    sendFee: sequelize.DECIMAL(17, 8),
    sendFeeUsd: sequelize.DECIMAL(4, 2),
    ethGasUsed: sequelize.INTEGER,
    ethGasPrice: sequelize.INTEGER,
    ethNonce: sequelize.INTEGER
})

const usdt_clear_deposits = db.define('usdt_clear_deposits', {
    ucd_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    ucd_merchantId: sequelize.STRING,
    ucd_createdEpoch: sequelize.INTEGER,
    ucd_confirmedEpoch: sequelize.INTEGER,
    ucd_node: sequelize.STRING,
    ucd_token: sequelize.STRING,
    ucd_depositId: sequelize.STRING,
    ucd_amount: sequelize.DECIMAL(17, 8), //supports up to 100M and 8 decimals
    ucd_depositFee: sequelize.DECIMAL(6, 4),
    ucd_resellerFee: sequelize.DECIMAL(6, 4),
    ucd_depositAddr: sequelize.STRING,
    ucd_destinationAddr: sequelize.STRING,
    ucd_funderAddr: sequelize.STRING,
    ucd_status: sequelize.STRING,
    ucd_txid: sequelize.STRING,
    ucd_sendFee: sequelize.DECIMAL(17, 8),
    ucd_sendFeeUsd: sequelize.DECIMAL(4, 2),
    ucd_ethGasUsed: sequelize.INTEGER,
    ucd_ethGasPrice: sequelize.INTEGER,
    ucd_ethNonce: sequelize.INTEGER,
    ucd_createdAt: sequelize.DATE,
    ucd_updatedAt: sequelize.DATE,
}, {
    timestamps: false
});

const users = db.define('users', {
    id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    parentReseller: sequelize.STRING,
    merchantId: sequelize.STRING,
    email: sequelize.STRING,
    withdraw_fee: sequelize.DECIMAL(4, 2),
    reseller_fee: sequelize.DECIMAL(7, 4),
    fee: sequelize.DECIMAL(6, 4),
    name: sequelize.STRING,
    orgName: sequelize.STRING,
    country: sequelize.STRING,
    idNum: sequelize.STRING,
    mobileNum: sequelize.STRING,
    kycStatus: sequelize.STRING,
    businessRegNum: sequelize.STRING,
    businessNature: sequelize.STRING,
    address: sequelize.STRING,
    city: sequelize.STRING,
    state: sequelize.STRING,
    postcode: sequelize.STRING,
    password: sequelize.STRING,
    otp_secret: sequelize.STRING,
    otp_temp_secret: sequelize.STRING,
    code2fa: sequelize.STRING,
    code2faEpoch: sequelize.INTEGER,
    vericode: sequelize.STRING,
    vericodeEpoch: sequelize.INTEGER,
    isWithdrawing: sequelize.BOOLEAN,
    isVerified: sequelize.BOOLEAN,
    isAdmin: sequelize.BOOLEAN,
    isReseller: sequelize.BOOLEAN,
    ipn_url: sequelize.STRING,
    ipn_handle: sequelize.BOOLEAN,
    forceTx: sequelize.BOOLEAN,
    isActive: sequelize.BOOLEAN,
    lastCountry: sequelize.STRING,
    lastRegion: sequelize.STRING,
    lastIP: sequelize.STRING,
    lastActive: {
        type: sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.NOW
    },
    createdEpoch: sequelize.INTEGER
});

const withdrawals = db.define('withdrawals', {
    id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    merchantId: sequelize.STRING,
    withdrawalId: sequelize.STRING,
    createdEpoch: sequelize.INTEGER,
    confirmedEpoch: sequelize.INTEGER,
    node: sequelize.STRING,
    token: sequelize.STRING,
    type: sequelize.STRING,
    amount: sequelize.DECIMAL(17, 8), //supports up to 100M and 8 decimals
    fee: sequelize.DECIMAL(4, 2),
    resellerFee: sequelize.DECIMAL(7, 4),
    destinationAddr: sequelize.STRING,
    senderAddr: sequelize.STRING,
    status: sequelize.STRING,
    txid: sequelize.STRING,
    sendFee: sequelize.DECIMAL(17, 8),
    sendFeeUsd: sequelize.DECIMAL(4, 2),
    chargedSendFeeUsd: sequelize.DECIMAL(4, 2),
    ethGasUsed: sequelize.INTEGER,
    ethGasPrice: sequelize.INTEGER,
    ethNonce: sequelize.INTEGER
})

const ipn_history = db.define('ipn_history', {
    ipn_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    ipn_merchantId: sequelize.STRING,
    ipn_orderId: sequelize.STRING,
    ipn_paymentAddr: sequelize.STRING,
    ipn_transactionAmt: sequelize.DECIMAL(26, 10),
    ipn_currentReceived: sequelize.DECIMAL(26, 10),
    ipn_totalReceived: sequelize.DECIMAL(26, 10),
    ipn_status: sequelize.STRING,
    ipn_req_body: sequelize.TEXT,
    ipn_res_body: sequelize.TEXT,
    ipn_times_sent: sequelize.INTEGER,
    ipn_lastSent_epoch: sequelize.INTEGER,
    ipn_epoch: sequelize.INTEGER,
    ipn_createdAt: sequelize.DATE
}, {
    timestamps: false,
    freezeTableName: true
})

const merch_deposit_addrs = db.define('merch_deposit_addrs', {
    mda_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    mda_merchantId: sequelize.STRING,
    mda_label: sequelize.STRING,
    mda_node: sequelize.STRING,
    mda_token: sequelize.STRING,
    mda_depositAddr: sequelize.STRING,
    mda_isProcessing: sequelize.BOOLEAN,
    mda_createdAt: sequelize.DATE,
    mda_updatedAt: sequelize.DATE,
}, {
    timestamps: false
});

// const blockchain_blocks = db.define('blockchain_blocks', {
//     blk_id: {
//         type: sequelize.INTEGER,
//         primaryKey: true
//     },
//     blk_hash: sequelize.STRING,
//     blk_confirmations: sequelize.INTEGER,
//     blk_strippedsize: sequelize.INTEGER,
//     blk_size: sequelize.INTEGER,
//     blk_weight: sequelize.INTEGER,
//     blk_height: sequelize.INTEGER,
//     blk_version: sequelize.INTEGER,
//     blk_versionHex: sequelize.STRING,
//     blk_merkleroot: sequelize.STRING,
//     blk_tx: sequelize.TEXT,
//     blk_time: sequelize.INTEGER,
//     blk_mediantime: sequelize.INTEGER,
//     blk_nonce: sequelize.INTEGER,
//     blk_bits: sequelize.STRING,
//     blk_difficulty: sequelize.STRING,
//     blk_chainwork: sequelize.STRING,
//     blk_previousblockhash: sequelize.STRING,
//     blk_lastUpdatedEpoch: sequelize.INTEGER,
//     blk_createdEpoch: sequelize.INTEGER,
//     blk_createdAt: sequelize.DATE
// }, {timestamps: false})

// const omni_transactions = db.define('omni_transactions', {
//     otx_id: {
//         type: sequelize.INTEGER,
//         primaryKey: true
//     },
//     otx_txid: sequelize.STRING,
//     otx_fee: sequelize.DECIMAL(26, 10),
//     otx_sendingaddress: sequelize.STRING,
//     otx_referenceaddress: sequelize.STRING,
//     otx_ismine: sequelize.BOOLEAN,
//     otx_version: sequelize.STRING,
//     otx_type_int: sequelize.INTEGER,
//     otx_type: sequelize.STRING,
//     otx_subType: sequelize.STRING,
//     otx_propertyid: sequelize.STRING,
//     otx_divisible: sequelize.BOOLEAN,
//     otx_amount: sequelize.DECIMAL(26, 10),
//     otx_bitcoindesired: sequelize.DECIMAL(26, 10),
//     otx_timelimit: sequelize.DECIMAL,
//     otx_feerequired: sequelize.DECIMAL(26, 10),
//     otx_action: sequelize.STRING,
//     otx_vout: sequelize.STRING,
//     otx_amountpaid: sequelize.DECIMAL(26, 10),
//     otx_propertyidforsale: sequelize.INTEGER,
//     otx_propertyidforsaleisdivisible: sequelize.BOOLEAN,
//     otx_amountforsale: sequelize.DECIMAL(26, 10),
//     otx_propertyiddesired: sequelize.INTEGER,
//     otx_propertyiddesiredisdivisible: sequelize.BOOLEAN,
//     otx_amountdesired: sequelize.DECIMAL(26, 10),
//     otx_unitprice: sequelize.DECIMAL,
//     otx_purchasedpropertyid: sequelize.INTEGER,
//     otx_purchasedpropertyname: sequelize.STRING,
//     otx_purchasedpropertydivisible: sequelize.BOOLEAN,
//     otx_purchasedtokens: sequelize.DECIMAL,
//     otx_issuertokens: sequelize.DECIMAL,
//     otx_valid: sequelize.INTEGER,
//     otx_invalidreason: sequelize.STRING,
//     otx_blockhash: sequelize.STRING,
//     otx_blocktime: sequelize.INTEGER,
//     otx_positioninblock: sequelize.INTEGER,
//     otx_block: sequelize.INTEGER,
//     otx_confirmations: sequelize.INTEGER,
//     otx_lastUpdatedEpoch: sequelize.INTEGER,
//     otx_createdEpoch: sequelize.INTEGER,
//     otx_createdAt: sequelize.DATE
// }, {timestamps: false})

const ethereum_keys = db.define('ethereum_keys', {
    ek_pkey: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    ek_version: sequelize.STRING,
    ek_id: sequelize.STRING,
    ek_address: sequelize.STRING,
    ek_keyJson: sequelize.TEXT,
    ek_lastSignedEpoch: sequelize.BOOLEAN,
    ek_createdEpoch: sequelize.INTEGER,
    ek_createdAt: sequelize.DATE
}, {
    timestamps: false
})

const eth_fund_txs = db.define('eth_fund_txs', {
    eft_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    eft_merchantId: sequelize.STRING,
    eft_type: sequelize.STRING,
    eft_orderId: sequelize.STRING,
    eft_createdEpoch: sequelize.INTEGER,
    eft_confirmedEpoch: sequelize.INTEGER,
    eft_token: sequelize.STRING,
    eft_amount: sequelize.DECIMAL(26, 10),
    eft_paymentAddr: sequelize.STRING,
    eft_status: sequelize.STRING,
    eft_txid: sequelize.STRING,
    eft_sendFee: sequelize.DECIMAL(26, 8),
    eft_sendFeeUsd: sequelize.DECIMAL(6, 2),
    eft_ethGasUsed: sequelize.INTEGER,
    eft_ethGasPrice: sequelize.INTEGER,
    eft_ethNonce: sequelize.INTEGER,
    eft_createdAt: sequelize.DATE
}, {
    timestamps: false
})

const supportedTokens = db.define('supportedTokens', {
    st_node: {
        type: sequelize.STRING,
        primaryKey: true
    },
    st_token: {
        type: sequelize.STRING,
        primaryKey: true
    },
    st_active: sequelize.BOOLEAN
}, {
    timestamps: false
});

const configs = db.define('configs', {
    conf_code: {
        type: sequelize.STRING,
        primaryKey: true
    },
    conf_cat1: sequelize.STRING,
    conf_cat2: sequelize.STRING,
    conf_cat3: sequelize.STRING,
    conf_value: sequelize.STRING
}, {
    timestamps: false
});

const usertokenconfigs = db.define('usertokenconfigs', {
    utc_id: {
        type: sequelize.STRING,
        primaryKey: true
    },
    utc_merchantId: sequelize.STRING,
    utc_node: sequelize.STRING,
    utc_token: sequelize.STRING,
    utc_min_forward: sequelize.DECIMAL
}, {
    timestamps: false
});

const telegram_bots = db.define('telegram_bots', {
    update_id: sequelize.INTEGER
})

const logs = db.define('logs', {
    log_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    log_type: sequelize.STRING,
    log_cat1: sequelize.STRING,
    log_cat2: sequelize.STRING,
    log_cat3: sequelize.STRING,
    log_message: sequelize.TEXT,
    log_error: sequelize.TEXT,
    log_created_epoch: sequelize.INTEGER
}, {
    timestamps: false
});

const user_activity_logs = db.define('user_activity_logs', {
    ual_id: {
        type: sequelize.INTEGER,
        primaryKey: true
    },
    ual_merchantId: sequelize.STRING,
    ual_category: sequelize.STRING,
    ual_message: sequelize.STRING,
    ual_rowId: sequelize.STRING,
    ual_table: sequelize.STRING,
    ual_col: sequelize.STRING,
    ual_oldVal: sequelize.TEXT,
    ual_newVal: sequelize.TEXT,
    ual_createdAt: sequelize.DATE
}, {
    timestamps: false
});

api_keys.sync();
module.exports.api_keys = api_keys;

whitelisted_ips.sync();
module.exports.whitelisted_ips = whitelisted_ips;

usdt_tx_batches.sync();
module.exports.usdt_tx_batches = usdt_tx_batches;

usdt_clear_batches.sync();
module.exports.usdt_clear_batches = usdt_clear_batches;

usdt_clear_deposits.sync();
module.exports.usdt_clear_deposits = usdt_clear_deposits;

users.sync();
module.exports.users = users;

withdrawals.sync();
module.exports.withdrawals = withdrawals;

ipn_history.sync();
module.exports.ipn_history = ipn_history;

merch_deposit_addrs.sync();
module.exports.merch_deposit_addrs = merch_deposit_addrs;

// blockchain_blocks.sync();
// module.exports.blockchain_blocks = blockchain_blocks;

// omni_transactions.sync();
// module.exports.omni_transactions = omni_transactions;

ethereum_keys.sync();
module.exports.ethereum_keys = ethereum_keys;

eth_fund_txs.sync();
module.exports.eth_fund_txs = eth_fund_txs;

supportedTokens.sync();
module.exports.supportedTokens = supportedTokens;

configs.sync();
module.exports.configs = configs;

telegram_bots.sync();
module.exports.telegram_bots = telegram_bots;

usertokenconfigs.sync();
module.exports.usertokenconfigs = usertokenconfigs;

logs.sync();
module.exports.logs = logs;

user_activity_logs.sync();
module.exports.user_activity_logs = user_activity_logs;

module.exports.db = db;
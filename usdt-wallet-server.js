const run_config = require('./config/run_config.js')
var argv = process.argv[2]

//Setup check
if (!process.argv[2] || run_config[argv] == undefined) {
    console.log('\x1b[41m%s\x1b[0m', "-E- Please specify run condition.")
    process.exit(1)
}

var prefix = run_config[argv].PREFIX
var port = run_config[argv].PORT

if (!port) {
    console.log('\x1b[41m%s\x1b[0m', "-E- PORT not specified!")
    process.exit(1)
}
if (!prefix) {
    console.log('\x1b[41m%s\x1b[0m', "-E- PREFIX not specified!")
    process.exit(1)
}

//to be passed to ./lib/lib.js
module.exports = run_config[argv]

var express = require('express');
const bodyParser = require('body-parser');
const router = require('./router.js')
const wallet = require('./lib/wallet-local')
const db = require('./db/sql.js').db;
const app = express();
const busboy = require('connect-busboy');
const busboyBodyParser = require('busboy-body-parser');
const cors = require('cors');
const helmet = require('helmet')

app.use(helmet());

// body-parser gets access to the post data for all the http requests
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

app.use(busboy());
app.use(busboyBodyParser());

app.enable("trust proxy");
app.use(cors());
app.use(prefix, router);

var server = app.listen(port, function() {
    console.log("\x1b[32m%s\x1b[0m", '-I- Wallet service listening on port: ' + port);
})


const lib = require('./lib/lib.js');
const socketIoServer = require('socket.io')( server, {
    serveClient: false,
    // below are engine.IO options
    pingInterval: 10000,
    pingTimeout: 5000,
    cookie: false
});
lib.webSocket.initialize(socketIoServer);

db.authenticate().then(() => {
        console.log("\x1b[32m%s\x1b[0m", '-I- SQL connected!');
    })
    .catch(err => {
        console.error("\x1b[31m%s\x1b[0m", '-E- Unable to connect to the SQL database:', err);
        process.exit()
    })

if (wallet.isSynced()) {
    console.log("\x1b[32m%s\x1b[0m", '-I- Node Synced! Port: ' + run_config[argv].USDT_NODE.PORT + ' Host: ' + run_config[argv].USDT_NODE.HOST)
} else {
    console.log("\x1b[31m%s\x1b[0m", '-I- Node Not Synced! Port: ' + run_config[argv].USDT_NODE.PORT + 'Host: ' + run_config[argv].USDT_NODE.HOST)
    process.exit()
}

require("./lib/cron_job.js");
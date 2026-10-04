const CoinCore = require('./CoinCore.class.js').CoinCore;
const lib = require('./CoinCore.class.js').lib;
const bitcore = require("bitcoin-core");
const bitcoin = require("bitcoinjs-lib");
const net = bitcoin.networks.bitcoin;
const SQL = lib.SQL
const BLOCK_INFO = `https://blockchain.info`

/*
* Coin Core for Bitcoin
* Contains all functions related to manipulating and getting information on Bitcoin in the Bitcoin blockchain
*/

class CoinCore_OMNI_BTC extends CoinCore {

    constructor() {
        super();

        this.coreType = 'BTC';

        this.client = new bitcore({
            network: lib.CONFIG.USDT_NODE.NETWORK,
            port: lib.CONFIG.USDT_NODE.PORT,
            host: lib.CONFIG.USDT_NODE.HOST,
            username: lib.CONFIG.USDT_NODE.USER,
            password: lib.CONFIG.USDT_NODE.PASSWORD
        });
    }

    validate(result) {
        if (result == undefined) {
            return {
                error: "Please specify rpc result in argument."
            }
        }
        if (JSON.stringify(result).toLowerCase().includes("rpcerror")) {
            return {
                error: "-E- " + result
            }
        } else {
            return result;
        }
    }
    
    //estimate fee bitcoin fees in bytes
    //default 405 bytes per transaction for (funding type)
    //default estimate fee for transaction to be mined within 6 blocks (10mins per block)
    async estimateFee(params) {
        console.log('estimateFee_' + this.coreType);

        let size = params.size || 405;
        let blocks = params.blocks || 6;

        //prep rpc command
        var batch = [{
            method: "estimatefee",
            parameters: [blocks]
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }
        var feeBtc = res[0] * (size / 1000)
        var btcPrice = await this.getBtcPrice()
        var feeUsd = parseFloat(feeBtc * btcPrice).toFixed(2)

        return feeUsd
    }

    async dumpPrivateKey(params) {
        console.log('dumpPrivateKey_' + this.coreType);

        let address = params.address;

        //prep rpc command
        var batch = [{
            method: "dumpprivkey",
            parameters: [address]
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }

        //console.log('dump', res)
        return res[0];
    }
    
    async importPrivateKey(params) {
        console.log('importPrivateKey_' + this.coreType);

        let privateKey = params.privateKey;
        let address = params.address;
        let rescan = params.rescan || false;

        //prep rpc command
        var batch = [{
            method: "importprivkey",
            parameters: [privateKey, address, rescan]
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }
        //console.log(res)
        return res;
    }
    
    
    async createAcc(params) {
        console.log('createAcc_' + this.coreType);

        //generate address details
        var walletData = {}; //declare
        var netObj = {
            network: net
        };

        var keyPair = bitcoin.ECPair.makeRandom(netObj);

        const { address } = bitcoin.payments.p2pkh({
            pubkey: keyPair.publicKey
        });
        
        var pk = keyPair.toWIF();

        walletData["address"] = address;
        walletData["privateKey"] = pk; //get Wallet input format
        
        let importParams = {
            privateKey: walletData.privateKey, 
            address: walletData.address
        }
        var res = await this.importPrivateKey(importParams);
        if (res.error) {
            return res;
        }
        //console.log(res)
        return {
            address: walletData.address,
            privateKey: walletData.privateKey
        };
    }

    async validateAddr(params) {
        console.log('validateAddr_' + this.coreType);

        let address = params.address;

        let valid = await lib.walletValid.validate(address, 'BTC')

        //console.log(res[0])
        return valid;
    }
    
    async getTransaction(params) {
        console.log('getTransaction_' + this.coreType);

        let txid = params.txid;

        //prep rpc command
        var batch = [{
            method: "gettransaction",
            parameters: [txid]
        }];

        var res = await client.command(
            batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }

        //console.log(res[0])
        return res[0];
    }

    async getPendingTx(params) {
        console.log('getPendingTx_' + this.coreType);

        let address = params.address;
    }
    
    //address needs to be from wallet.
    //Returns complete transactions for wallets that are generated and imported to wallet.dat since usage.
    async listTransactions(params) {
        console.log('listTransactions_' + this.coreType);

        let address = params.address;

        //prep rpc command
        var batch = [{
            method: "listtransactions",
            parameters: [address]
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }

        //console.log(res[0])
        return res[0];
    }

    //List all accounts in wallet.dat
    async listAccounts(params) {
        console.log('listAccounts_' + this.coreType);

        //prep rpc command
        var batch = [{
            method: "listaccounts",
            parameters: []
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }

        //console.log(res[0])
        return res[0];
    }
    
    async getBalance(params) {
        // console.log('getBalance_' + this.coreType);

        let address = params.address || null;

        if (address == null) {
            throw new Error("No address provided");
        }

        let result = null;
        let statusCode = 0;

        if(Array.isArray(params.address)){

            var command = `${BLOCK_INFO}/balance?active=`
            
            for(let addr  of params.address){
                command += addr + '|';
            }
        
            do{
                // Reset status code to 0 after requesting again
                statusCode = 0;

                var balObj = await lib.requestpn(
                    command
                )
                .then(JSON.parse).catch(async e => {
                    // Status Code 429 occurs when there are too many requests. Try again until succeed if status code is 429
                    statusCode = e.statusCode || 0;

                    if(statusCode != 429){
                        return {
                            error: e.message
                        }
                    }

                    // Wait a few seconds before requesting again
                    await this.delay(3000);
                });
            }
            while (statusCode == 429)

            
        
            if (balObj.constructor === Object) {

                result = {};
                //convert satoshi to btc
                for(let addr of params.address){
                    result[addr] = this.convertSatoshiToBtc(balObj[addr].final_balance);
                }

                return result
            }
            
        }else{
            
            do{
                // Reset status code to 0 after requesting again
                statusCode = 0;

                var balObj = await lib.requestpn(
                    `${BLOCK_INFO}/balance?active=` + params.address
                )
                .then(JSON.parse).catch(async e => {
                    // Status Code 429 occurs when there are too many requests. Try again until succeed if status code is 429
                    statusCode = e.statusCode || 0;

                    if(statusCode != 429){
                        return {
                            error: e.message
                        }
                    }

                    // Wait a few seconds before requesting again
                    await this.delay(3000);
                });
            }
            while (statusCode == 429)
            
            
            if (balObj.constructor === Object) {

                result = this.convertSatoshiToBtc(balObj[params.address].final_balance);

                return result
            }
        }
        
        //console.log(res[0])
        return result;
    }

    async getWalletBalances(params) {
        // console.log('getWalletBalances_' + this.coreType);

        var batch = [{
            method: "listaccounts",
            parameters: []
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }

        //console.log(res[0])
        return res[0];
    }

    async getWalletTotal(params) {
        console.log('getWalletTotal_' + this.coreType);

        //prep rpc command
        var batch = [{
            method: "getbalance",
            parameters: []
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }
        
        //console.log(res[0])
        return res[0];
    }
    
    async sendTransaction(params) {
        console.log('sendTransaction_' + this.coreType);

        let sender = params.sender;
        let recipient = params.recipient;
        let amount = params.amount;

        //prep rpc command
        var batch = [{
            method: "sendfrom",
            parameters: [sender, recipient, amount]
        }];

        var res = await client.command(batch);
        if (this.validate(res).error) {
            return this.validate(res);
        }

        //console.log(res[0])
        return res[0];
    }

    async computeAddressReceivedSQL(params) {
        console.log('computeAddressReceivedSQL_' + this.coreType);
    }
}

module.exports = CoinCore_OMNI_BTC;
const CoinCore = require('./CoinCore.class.js').CoinCore;
const lib = require('./CoinCore.class.js').lib;
const log = require('../console_log.js')
const bitcore = require("bitcoin-core");
const bitcoin = require("bitcoinjs-lib");
const net = bitcoin.networks.bitcoin;
const USDT = 31
const SQL = lib.SQL

/*
* Coin Core for OMNI USDT
* Contains all functions related to manipulating and getting information on OMNI USDT in the Bitcoin blockchain
*/

class CoinCore_OMNI_USDT extends CoinCore {

    constructor() {
        super();

        this.coreType = 'USDT';

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
            throw new Error("Please specify rpc result in argument.");
        }
        if (JSON.stringify(result).toLowerCase().includes("rpcerror")) {
            throw new Error("-E- " + result);
        } else {
            return result;
        }
    }

    // Check if address exists in wallet.dat
    async isAddressInWallet(address) {
        try{
            //prep rpc command
            var batch = [{
                method: "getaccount",
                parameters: [address]
            }]

            var result = await client.command(batch);
            this.validate(result);

            if(result[0].length > 0){
                return true;
            }else{
                return false;
            }   
        }catch(err){
            throw err;
        }
         
    }
    
    //estimate fee bitcoin fees in bytes
    //default 405 bytes per transaction for (funding type)
    //default estimate fee for transaction to be mined within 6 blocks (10mins per block)
    async estimateFee(params) {
        try{
            // console.log('estimateFee_' + this.coreType);

            let size = params.size || 405;
            let blocks = params.blocks || 6;

            //prep rpc command
            var batch = [{
                method: "estimatefee",
                parameters: [blocks]
            }];

            var res = await client.command(batch);
            this.validate(res);

            var feeBtc = res[0] * (size / 1000)
            var btcPrice = await this.getBtcPrice()
            var feeUsd = parseFloat(feeBtc * btcPrice).toFixed(2)

            return feeUsd
        }catch(err){
            throw err;
        }        
    }

    async dumpPrivateKey(params) {
        try{
            console.log('dumpPrivateKey_' + this.coreType);

            let address = params.address;

            //prep rpc command
            var batch = [{
                method: "dumpprivkey",
                parameters: [address]
            }];

            var res = await client.command(batch);
            this.validate(res);

            //console.log('dump', res)
            return res[0];
        }catch(err){
            throw err;
        }
    }
    
    async importPrivateKey(params) {
        try{
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
            this.validate(res);

            //console.log(res)
            return res;
        }catch(err){
            throw err;
        }
        
    }
    
    //faster account generation
    async createAcc(params) {
        try{
            console.log('createAcc_' + this.coreType);

            //generate address details
            var walletData = {}; //declare
            var netObj = {
                network: net
            };

            var keyPair = bitcoin.ECPair.makeRandom(netObj);

            const { address } = bitcoin.payments.p2pkh({
                pubkey: keyPair.publicKey, 
                network: net
            });
            
            var pk = keyPair.toWIF();

            walletData["address"] = address;
            walletData["privateKey"] = pk; //get Wallet input format

            let importParams = {
                privateKey: walletData.privateKey, 
                address: walletData.address
            }
            var res = await this.importPrivateKey(importParams);

            if(!await this.isAddressInWallet(walletData.address)){
                throw new Error("Address not found in wallet!");
            }

            //console.log(res)
            return {
                address: walletData.address,
                privateKey: walletData.privateKey
            };
        }catch(err){
            throw err;
        }
    }

    async validateAddr(params) {
        console.log('validateAddr_' + this.coreType);

        let address = params.address;

        let valid = await lib.walletValid.validate(address, 'BTC')

        //console.log(res[0])
        return valid;
    }
    
    //Returns error if txid is not omni type
    async getTransaction(params) {
        try{
            // console.log('getTransaction_' + this.coreType);

            let txid = params.txid;

            //prep rpc command
            var batch = [{
                method: "omni_gettransaction",
                parameters: [txid]
            }];

            var res = await client.command(batch);
            this.validate(res)

            //console.log(res[0])
            return res[0];
        }catch(err){
            throw err;
        }
    }

    //Returns error if txid is not omni type
    async getPendingTx(params) {
        try{
            // console.log('getPendingTx_' + this.coreType);

            let address = params.address;

            //prep rpc command
            var batch = [{
                method: "omni_listpendingtransactions",
                parameters: [address]
            }];

            var res = await client.command(batch);
            this.validate(res)

            //console.log(res[0])
            return res[0];
        }catch(err){
            throw err;
        }
    }
    
    //address needs to be from wallet.
    //Returns complete transactions for wallets that are generated and imported to wallet.dat since usage.
    async listTransactions(params) {
        try{
            console.log('listTransactions_' + this.coreType);

            let address = params.address;

            //prep rpc command
            var batch = [{
                method: "omni_listtransactions",
                parameters: [address, 99999999, 0, 556128]
            }];

            var res = await client.command(batch);
            this.validate(res);

            //console.log(res)
            return res[0];
        }catch(err){
            throw err;
        }
    }

    //List all accounts in wallet.dat
    async listAccounts(params) {
        try{
            console.log('listAccounts_' + this.coreType);

            //prep rpc command
            var batch = [{
                method: "listaccounts",
                parameters: []
            }];

            var res = await client.command(batch);
            this.validate(res)

            //console.log(res[0])
            return res[0];
        }catch(err){
            throw err;
        }
        
    }
    
    async getBalance(params) {
        try{
            // console.log('getBalance_' + this.coreType);

            let address = params.address || null;

            if (address == null) {
                throw new Error("No address provided");
            }

            let result = null;
            
            if(Array.isArray(params.address)){
                
                result = [];
                
                for(let address of params.address){
                    var batch = [{
                        method: "omni_getbalance",
                        parameters: [address, 31]
                    }];
    
                    var res = await client.command(batch);
                    this.validate(res)

                    result[address] = res[0].balance;

                    await this.delay(2);
                }
            }else{
                var batch = [{
                    method: "omni_getbalance",
                    parameters: [address, 31]
                }];

                var res = await client.command(batch);
                this.validate(res)

                result = res[0].balance;
            }

            //console.log(res[0])
            return result;
        }catch(err){
            throw err;
        }
        
    }

    async getWalletBalances(params) {
        try{
            // console.log('getWalletBalances_' + this.coreType);

            //prep rpc command
            var batch = [{
                method: "omni_getwalletaddressbalances"
            }];

            var res = await client.command(batch);
            this.validate(res)

            let formattedBalances = [];
            
            for(let addressData of res[0]){
                
                let address = addressData.address;

                for(let balanceData of addressData.balances){
                    if(balanceData.propertyid == 31){
                        formattedBalances[address] = balanceData.balance;
                    }
                }
            }
            return formattedBalances;
        }catch(err){
            throw err;
        }
        
    }

    async getWalletTotal(params) {

        try{
            console.log('getWalletTotal_' + this.coreType);

            //prep rpc command
            var batch = [{
                method: "omni_getwalletbalances",
                parameters: []
            }];

            var res = await client.command(batch);
            this.validate(res)
            
            let walletTotal = 0;

            for(let propertyData of res[0]){
                if(propertyData.propertyid == 31){
                    walletTotal = propertyData.balance;
                    return walletTotal;
                }
            }
            
            return walletTotal;
        }catch(err){
            throw err;
        }
    }
    
    //Sends push tx with funder for btc fee if funder is specified.
    //funder, recipient in run.config
    async sendTransaction(params) {
        try{
            console.log('sendTransaction_' + this.coreType);
            
            //declare
            let hash = "";
            let sender = params.sender;
            let recipient = params.recipient;
            let amount = params.amount;
            let funder = params.funder || null;


            //prep rpc command
            var batch = [{
                method: "omni_send",
                parameters: [sender, recipient, 31, amount]
            }];

            if (funder != null) {
                var batch = [{
                    method: "omni_funded_send",
                    parameters: [sender, recipient, 31, amount, funder]
                }];
            }

            if (!this.auto_send) {
                return {
                    skip: "Send transaction is switched off by auto_send:false"
                }
            }

            //call omni_send
            var res = await client.command(batch);
            this.validate(res);
            
            hash = res[0];
            
            //call fetch transaction details to confirm it is recorded.
            let txParams = {
                txid: hash
            }
            var resHash = await this.getTransaction(txParams);
            this.validate(resHash)
                
            return hash;
            
        }catch(err){
            throw err;
        }
        
    }

    async computeAddressReceivedSQL(params) {
        try{
            // console.log('computeAddressReceivedSQL_' + this.coreType);

            let address = params.address;
            
            if (!address || typeof address != "string") {
                // console.log("-E- txid param not valid.")
                return {
                    error: "Please make sure that argument specified is a string."
                };
            }

            //fetch all scheduled forward tx that are not equals to INVALID
            var totalAmt = 0
            totalAmt = await SQL.usdt_clear_batches.sum('amount', {
                where: {
                    paymentAddr: address,
                    status: {
                        [lib.Op.notIn]: ['INVALID', 'OPEN']
                    }
                }
            })

            if (!totalAmt) {
                totalAmt = 0
            }

            return parseFloat(totalAmt);

        }catch(err){
            throw err;
        }
        
    }
}

module.exports = CoinCore_OMNI_USDT;
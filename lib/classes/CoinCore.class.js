const lib = require("../lib.js");
const BLOCK_INFO = `https://blockchain.info`
const SQL = lib.SQL

/*
* Parent class for all OMNI Token Coin Cores
* Abstract Class to enforce certain functions to be implemented in children
* Contains general functions that can be used by all child classes
*/

class CoinCore {

    constructor() {

        this.auto_send = true; //Switch to false to prevent send transaction

        if (this.constructor === CoinCore) {
            throw new TypeError('Abstract class "CoinCore" cannot be instantiated directly.'); 
        }

        if (this.estimateFee === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method estimateFee');
        }

        if (this.dumpPrivateKey === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method dumpPrivateKey');
        }

        if (this.importPrivateKey === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method importPrivateKey');
        }

        if (this.createAcc === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method createAcc');
        }

        if (this.getTransaction === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method getTransaction');
        }

        if (this.getPendingTx === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method getPendingTx');
        }

        if (this.listTransactions === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method listTransactions');
        }

        if (this.listAccounts === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method listAccounts');
        }

        if (this.getBalance === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method getBalance');
        }

        if (this.getWalletBalances === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method getWalletBalances');
        }

        if (this.getWalletTotal === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method getWalletTotal');
        }

        if (this.sendTransaction === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method sendTransaction');
        }

        if (this.computeAddressReceivedSQL === undefined) {
            throw new TypeError('Classes extending the CoinCore Abstract Class must implement the method computeAddressReceivedSQL');
        }
    }

    delay(t, val) {
        return new Promise(function(resolve) {
            setTimeout(function() {
                resolve(val);
            }, t);
        });
    } //end of delay

    async getBtcPrice(convert = 'USD') {

        if (typeof convert != "string") {
            return {
                error: "Invalid input conversion value."
            }
        }
    
        var priceObj = await lib.requestpn(`${BLOCK_INFO}/ticker`)
        try {
            const data = JSON.parse(priceObj)
            if (data[convert].last == undefined) {
                return {
                    error: "Conversion pair is not recognised, please try again later."
                }
            } else {
                return data[convert].last
            }
        } catch (err) {
            return {
                error: err
            }
        }
    } //end of getBtcPrice

    convertSatoshiToBtc(satoshi) {
        if (satoshi == 0) {
            return satoshi
        } else {
            return (satoshi / 100000000)
        }
    }

    /*
    
    async estimateFee(params) {
        throw new Error('You have to implement the method estimateFee!');
    }

    async dumpPrivateKey(params) {
        throw new Error('You have to implement the method dumpPrivateKey!');
    }
    
    async importPrivateKey(params) {
        throw new Error('You have to implement the method importPrivateKey!');
    }
    
    //faster account generation
    async createAcc(params) {
        throw new Error('You have to implement the method createAcc!');
    }
    
    //Returns error if txid is not omni type
    async getTransaction(params) {
        throw new Error('You have to implement the method getTransaction!');
    }
    
    //address needs to be from wallet.
    //Returns complete transactions for wallets that are generated and imported to wallet.dat since usage.
    async listTransactions(params) {
        throw new Error('You have to implement the method listTransactions!');
    }

    //List all accounts in wallet.dat
    async listAccounts(params) {
        throw new Error('You have to implement the method listAccounts!');
    }
    
    //input: array
    //Check if addresses exist in wallet
    async getBalance(params) {
        throw new Error('You have to implement the method getBalance!');
    }
    
    //Sends push tx with funder for btc fee if funder is specified.
    //funder, recipient in run.config
    async sendTransaction(params) {
        throw new Error('You have to implement the method sendTransaction!');
    }

    */
}

module.exports = {
    CoinCore,
    lib
};
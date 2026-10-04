

const lib = require('./lib.js');
const dashboard = require('./dashboard.js')
const socketIoServer = require("../usdt-wallet-server.js");

class WebSocket {

    constructor() {

        this.initialized = false;
        this.socketIoServer = null;
        this.connectedClients = {};

    }

    initialize(server){

        this.socketIoServer = server;
        this.initialized = true;

        // Setting up a socket with the namespace "connection" for new sockets
        this.socketIoServer.on("connection", async socket => {
        
            // Only accept authorized connections
            let jwtToken = socket.handshake.query.jwt;
            let result = null;
            try{
                result = lib.jwt.verify(jwtToken, lib.CONFIG.ENDPOINTS.SECRET);
            }catch(err){
                // console.log(err);
                return;
            }
            
            // Find user object associated with jwt id
            let userObj = await lib.SQL.users.findOne({where: {id: result.id}});

            if(this.connectedClients[userObj.merchantId]){
                console.log("Force Disconnect Socket ID: " + this.connectedClients[userObj.merchantId].id);
                this.connectedClients[userObj.merchantId].disconnect();
            }
        
            this.connectedClients[userObj.merchantId] = socket;
        
            // console.log((new Date()) + ' Received a new connection from origin ' + socket.handshake.headers.origin + '.');
            // console.log("Merchant ID: " + userObj.merchantId + " || " + "Socket ID: " + socket.id);


            this.initialEmit(userObj.merchantId);

            // //Here we listen on a new namespace called "incoming data"
            // socket.on("incoming data", (data)=>{
            //     //Here we broadcast it out to all other sockets EXCLUDING the socket which sent us the data
            //     // socket.broadcast.emit("outgoing data", {num: data});
            // });
        
            //A special namespace "disconnect" for when a client disconnects
            socket.on("disconnect", data => {
                // console.log("Client Disconnected. Socket ID: " + socket.id)
                delete this.connectedClients[userObj.merchantId];
            });
        
        });

    }

    isClientConnected(merchantId){
        return (this.connectedClients[merchantId] != undefined) ? true : false;
    }

    emitData(params){
        
        if(params.merchantId == undefined){
            throw new Error("Must provide merchant ID");
        }
        
        if(this.connectedClients[params.merchantId] != undefined){
            this.connectedClients[params.merchantId].emit('fromApi', params);
        }

    }

    async initialEmit(merchantId){
        let orderCount = await dashboard.fetchOrderCount(merchantId);
                
        let emitJson = {
            merchantId: merchantId,
            data: orderCount
        }

        this.emitOrderCnt(emitJson);

        let latestOrders = await dashboard.getLatestOrders(merchantId);
                                                                    
        emitJson = {
            merchantId: merchantId,
            data: latestOrders
        }

        this.emitLatestOrders(emitJson);

        let balResults = await dashboard.fetchWithdrawBal(merchantId);
                                                                    
        emitJson = {
            merchantId: merchantId,
            data: balResults
        }

        this.emitBalances(emitJson);
    }

    emitOrderCnt(params){
        try{

            let data = params.data;

            let emitJson = {
                merchantId: params.merchantId,
                data: {
                    orderCount: {
                        total: data.orderCount,
                        confirmed: data.confirmCount,
                        pending: data.pendingCount
                    }
                }
            }
    
            this.emitData(emitJson);

        }catch(err){
            console.log(err);
            throw new Error(err);
        }
    }

    emitLatestOrders(params){
        try{

            let data = params.data;
            let latestOrders = [];


            for(let orderData of data){
                
                latestOrders.push({
                    orderId: orderData.orderId,
                    createdEpoch: orderData.created,
                    node: orderData.node,
                    token: orderData.token,
                    amount: orderData.amount,
                    paymentAddress: orderData.address,
                    status: orderData.status
                })
            }

            let emitJson = {
                merchantId: params.merchantId,
                data: {
                    latestOrders: latestOrders
                }
            }
    
            this.emitData(emitJson);

        }catch(err){
            console.log(err);
            throw new Error(err);
        }
    }

    emitBalances(params){
        try{

            let data = params.data;

            let balances = {};

            for(let node in data){

                balances[node] = {};

                for(let token in data[node]){

                    balances[node][token] = data[node][token].balance;
                }

            }
            let emitJson = {
                merchantId: params.merchantId,
                data: {
                    balances: balances
                }
            }
    
            this.emitData(emitJson);

        }catch(err){
            console.log(err);
            throw new Error(err);
        }
    }

}

module.exports = WebSocket;

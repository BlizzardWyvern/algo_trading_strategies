import { Market, TimeInForce, OrderType, OrderSide, PositionStatus, OrderResponseObject, MarketsResponseObject} from "@dydxprotocol/v3-client";
import { DYDXConnector, NetworkID } from 'dydx_nodejs_connector'


let connector: DYDXConnector

async function init(): Promise<void> {
    console.log("init...", DYDXConnector)
    connector = await DYDXConnector.build(NetworkID.RopstenTestNet)
}

async function pnlStrategy(market: Market, initialQuoteAssetSize: number, sizeMultiplier: number, openUnder: Number, closeAt: Number): Promise<void> {
    let positions = await connector.getPositions(market, PositionStatus.OPEN)
    if (positions === undefined) return //handle timeout error here at some point. Client needs relog after longer time

    //For now pretend quote asset is USD
    //Approximate position size based on USD that are wanted to spend (initialQuoteAssetSize)
    const initialSize = await approximateBaseAssetSize(market, initialQuoteAssetSize)
    if (positions.length == 0) {
        console.log("Market: %s \tNo existing positions found. Creatin new...", market)
        //open initial position
        openPosition(market, initialSize)
    }
    else {
        //is this always only one position?
        for (const pos of positions) {
            const pnl = connector.getPNLInPercent(pos)
            const posSize = Number(pos.size)
            const currPrice = Number((await connector.getMarkets(market))[market]['indexPrice'])
            const value = posSize * currPrice
            console.log("Market: %s\tPNL: %s\%\tSize: %s\tValue: %s$", market, pnl.toFixed(5), posSize.toFixed(3), value.toFixed(3))
            //minimum sell order size for BTC_USD is 0.001
            if (posSize < 0.001) {
                //position is very small, basically non-existent => create new
                console.log("Market: %s\tPosition too small, creating new...", market)
                openPosition(market, initialSize)
            }
            if (pnl < openUnder) {
                //increase position when value drops
                let size = Number((initialSize * sizeMultiplier).toFixed(3))
                //minimum order size for ETH_USD is 0.01
                if (size < 0.01){
                    size = 0.01
                }
                openPosition(market, size)
            }
            else if (pnl > closeAt) {
                //close position, take profit
                let size = Number(posSize.toFixed(3))
                //minimum sell order size for BTC_USD is 0.001
                if (size < 0.001){
                    size = 0.001
                }
                closePosition(market, size)
            }
        }
    }
}

async function approximateBaseAssetSize(market: Market, quoteAssetSize: number): Promise<number> {
    let marketInf: MarketsResponseObject = await connector.getMarkets(market)
    const price = marketInf[market]['indexPrice']

    //size can only be multiple of 0.0001 for BTC_USD (see DYDX API)
    //must be multiple of 0.001 for ETH_USD
    //TODO: adjust return value for different quantum sizes
    return Number((quoteAssetSize / Number(price)).toFixed(3))
}

async function openPosition(market: Market, size: Number): Promise<OrderResponseObject>{
        console.log("Opening new position for market %s of size %f", market, size)
        return await connector.createOrder(
            OrderSide.BUY,
            OrderType.MARKET,
            TimeInForce.IOC,
            undefined,
            String(size),
            "1000000000", //needed worst price max value (see API)
            undefined,
            undefined,
            market
        )
}

async function closePosition(market: Market, size: Number): Promise<OrderResponseObject>{
        console.log("Reducing position of market %s by %f", market, size)
        return await connector.createOrder(
            OrderSide.SELL,
            OrderType.MARKET,
            TimeInForce.IOC,
            undefined,
            String(size),
            "1", //needed, min sell value (see API)
            undefined,
            undefined,
            market
        )
}


init()

setInterval(async () => {
    //Start with 100$, buy more assets at 0.2% loss, increase position by 80% of current position
    //Sell at 1% profit and run everything again
    await pnlStrategy(Market.BTC_USD, 100, 0.8, -0.2, 1)
    await pnlStrategy(Market.ETH_USD, 100, 0.8, -0.2, 1)
}, 5000) //5 seconds intervall

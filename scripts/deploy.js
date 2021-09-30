async function main() {
    const buyingToken = "";
    const lockTime = 60 * 60 * 24 * 10;
    const uniswapRouter = "";

    const BuyNLock = await ethers.getContractFactory("BuyNLock");
    const buyNLock = await BuyNLock.deploy(buyingToken, lockTime, uniswapRouter);

    console.log("BuyNLock deployed to: " + buyNLock.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});
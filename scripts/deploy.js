async function main() {
    const swapPath = [];
    const lockTime = 0;
    const uniswapRouter = "";

    const BuyNLock = await ethers.getContractFactory("BuyNLock");
    const buyNLock = await BuyNLock.deploy(swapPath, lockTime, uniswapRouter);

    console.log("BuyNLock deployed to: " + buyNLock.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});
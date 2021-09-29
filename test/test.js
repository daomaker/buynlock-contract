const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");
const { inTransaction } = require("@openzeppelin/test-helpers/src/expectEvent");
const IUniswapV2Router = require("@uniswap/v2-periphery/build/IUniswapV2Router02.json");

describe("BuyNLock smart contract", function() {
    
    let owner, user1, user2, user3, contract, buyingToken, sellingToken, uniswapRouter;

    let lockTime = 60 * 60 * 24 * 10; // 10 days
    const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const sellingTokenDecimals = 6;
    const buyingTokenDecimals = 18;
    const PRECISION_LOSS = "10000000000000000";
    const MAX_LOCK_TIME = 60 * 60 * 24 * 60;

    const sleep = (s) => {
        return new Promise(resolve => setTimeout(resolve, s * 1000));
    }
    
    const parseUnits = (value, type = 0) => {
        let decimals;
        if (type == 0) {
            decimals = sellingTokenDecimals;
        } else {
            decimals = buyingTokenDecimals;
        }

        return ethers.utils.parseUnits(value.toString(), decimals);
    }
    
    const getDeadline = async () => {
        return await time.latest() + 300;
    }
    
    const getAmountOut = async (amountIn) => {
        const swapPath = [sellingToken.address, buyingToken.address];
        const amountsOut = await uniswapRouter.getAmountsOut(amountIn, swapPath);
        return amountsOut[amountsOut.length - 1];
    }

    const buyNLock = async (user, amountToSell) => {
        contract = contract.connect(user);

        const balance1OfContractBefore = await buyingToken.balanceOf(contract.address);
        const balance0OfUserBefore = await sellingToken.balanceOf(user.address);
        const userLockedAmountBefore = await contract.getLockedAmount(user.address);

        amountToSell = parseUnits(amountToSell, 0);
        const minAmountToBuy = await getAmountOut(amountToSell);
        const deadline = await getDeadline();

        sellingToken = sellingToken.connect(user);
        await sellingToken.approve(contract.address, amountToSell);
        await contract.buyNLock(amountToSell, minAmountToBuy, deadline);
        
        const balance1OfContractAfter = await buyingToken.balanceOf(contract.address);
        const balance0OfUserAfter = await sellingToken.balanceOf(user.address);
        const userLockedAmountAfter = await contract.getLockedAmount(user.address);

        expect(balance1OfContractAfter).to.equal(balance1OfContractBefore.add(minAmountToBuy));
        expect(balance0OfUserAfter).to.equal(balance0OfUserBefore.sub(amountToSell));
        expect(userLockedAmountAfter).to.equal(userLockedAmountBefore.add(minAmountToBuy));
    }

    const unlockBoughtTokens = async (user, expectedUnlockableAmount, expectedUnlocksCount) => {
        expectedUnlockableAmount = parseUnits(expectedUnlockableAmount, 1);
        contract = contract.connect(user);

        const balance1OfContractBefore = await buyingToken.balanceOf(contract.address);
        const balance1OfUserBefore = await buyingToken.balanceOf(user.address);
        const userLockedAmountBefore = await contract.getLockedAmount(user.address);

        const unlockableAmount = await contract.getUnlockableAmount(user.address);
        expect(unlockableAmount[0]).to.closeTo(expectedUnlockableAmount, PRECISION_LOSS);
        expect(unlockableAmount[1]).to.equal(expectedUnlocksCount);

        await contract.unlockBoughtTokens(user.address);

        const balance1OfContractAfter = await buyingToken.balanceOf(contract.address);
        const balance1OfUserAfter = await buyingToken.balanceOf(user.address);
        const userLockedAmountAfter = await contract.getLockedAmount(user.address);

        expect(balance1OfContractAfter).to.equal(balance1OfContractBefore.sub(unlockableAmount[0]));
        expect(balance1OfUserAfter).to.equal(balance1OfUserBefore.add(unlockableAmount[0]));
        expect(userLockedAmountAfter).to.equal(userLockedAmountBefore.sub(unlockableAmount[0]));

        // trying to unlock again
        await expect(contract.unlockBoughtTokens(user.address)).to.be.revertedWith("No unlockable amount");
    }

    before(async () => {
        [owner, user1, user2, user3] = await ethers.getSigners();

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        sellingToken = await ERC20Mock.deploy("MOCK1", "MOCK1", owner.address, parseUnits("1000", 0), sellingTokenDecimals);
        buyingToken = await ERC20Mock.deploy("MOCK2", "MOCK2", owner.address, parseUnits("1000", 1), buyingTokenDecimals);

        await sellingToken.approve(uniswapRouterAddress, parseUnits("500", 0));
        await buyingToken.approve(uniswapRouterAddress, parseUnits("500", 1));

        const userSellAmount = parseUnits("100", 0);
        const userBuyAmount = parseUnits("100", 1);
        await sellingToken.transfer(user1.address, userSellAmount);
        await sellingToken.transfer(user2.address, userSellAmount);
        await sellingToken.transfer(user3.address, userSellAmount);
        await buyingToken.transfer(user1.address, userBuyAmount);
        await buyingToken.transfer(user2.address, userBuyAmount);
        await buyingToken.transfer(user3.address, userBuyAmount);

        uniswapRouter = new ethers.Contract(uniswapRouterAddress, IUniswapV2Router.abi, owner);
        await uniswapRouter.addLiquidity(
            sellingToken.address,
            buyingToken.address,
            parseUnits("500", 0),
            parseUnits("500", 1),
            parseUnits("500", 0),
            parseUnits("500", 1),
            owner.address,
            await getDeadline()
        );
    });

    it("Deploys BuyNLock contract", async () => {
        const Contract = await ethers.getContractFactory("BuyNLock");
        const swapPath = [sellingToken.address, buyingToken.address];
        contract = await Contract.deploy(swapPath, lockTime, uniswapRouterAddress);

        expect(await contract.owner()).to.equal(owner.address);
        expect(await contract.swapPath(0)).to.equal(swapPath[0]);
        expect(await contract.swapPath(1)).to.equal(swapPath[1]);
        expect(await contract.lockTime()).to.equal(lockTime);
        expect(await contract.uniswapRouter()).to.equal(uniswapRouterAddress);
        expect(await contract.sellingToken()).to.equal(sellingToken.address);
        expect(await contract.buyingToken()).to.equal(buyingToken.address);
    });

    describe("Owner functions, access control", async () => {
        it("Only the owner can change the lock time", async() => {
            contract = contract.connect(owner);
            lockTime /= 2;
            await contract.setLockTime(lockTime);
            expect(await contract.lockTime()).to.equal(lockTime);

            contract = contract.connect(user1);
            await expect(contract.setLockTime(0)).to.be.revertedWith("Ownable: caller is not the owner");
        });
        
        it("Setting lock time reverts if the lockTime is greater than the MAX_LOCK_TIME", async() => {
            contract = contract.connect(owner);
            await expect(contract.setLockTime(MAX_LOCK_TIME + 1)).to.be.revertedWith("Lock time > MAX lock time");
        });

        it("Only the owner can pause buying", async() => {
            contract = contract.connect(owner);
            await contract.pause();
            expect(await contract.paused()).to.equal(true);
            await contract.unpause();
            expect(await contract.paused()).to.equal(false);

            contract = contract.connect(user1);
            await expect(contract.pause()).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Users can't buy when the contract is paused", async() => {
            contract = contract.connect(owner);
            await contract.pause();

            contract = contract.connect(user1);
            await expect(contract.buyNLock(parseUnits("5", 0), 0, await getDeadline())).to.be.revertedWith("Pausable: paused");

            contract = contract.connect(owner);
            await contract.unpause();
        });
    });

    describe("Buying and unlocking", async() => {
        it("Users buy and lock - day 0", async() => {
            await buyNLock(user1, 10);
            await buyNLock(user2, 10);
            await buyNLock(user3, 10);
        });

        it("Users buy and lock - day 1", async() => {
            await time.increase(time.duration.days(1));
            await buyNLock(user1, 10);
            await buyNLock(user2, 10);
            await buyNLock(user3, 10);
        });

        it("Users buy and lock - day 3", async() => {
            await time.increase(time.duration.days(2));
            await buyNLock(user1, 10);
            await buyNLock(user2, 10);
            await buyNLock(user3, 10);
        });

        it("A user tries to unlock too early - fails", async() => {
            await expect(contract.unlockBoughtTokens(user3.address)).to.be.revertedWith("No unlockable amount");
        });

        it("Users unlock bought tokens (1 unlock) - day 5", async() => {
            await time.increase(time.duration.days(2));
            await unlockBoughtTokens(user1, 9.77, 1);
            await unlockBoughtTokens(user2, 9.40, 1);
            await unlockBoughtTokens(user3, 9.04, 1);
        });

        it("Users unlock bought tokens (2 unlocks) - day 10", async() => {
            await time.increase(time.duration.days(5));
            await unlockBoughtTokens(user1, 16.52, 2);
            await unlockBoughtTokens(user2, 15.94, 2);
            await unlockBoughtTokens(user3, 15.38, 2);
        });

        it("The contract has no tokens by now", async() => {
            expect(await buyingToken.balanceOf(contract.address)).to.equal(0);
            expect(await sellingToken.balanceOf(contract.address)).to.equal(0);
        });

        it("A user is able to unlock instantly after the owner setting lockTime to zero", async() => {
            await buyNLock(user1, 10);
            
            contract = contract.connect(owner);
            await contract.setLockTime(0);

            await unlockBoughtTokens(user1, 7.05, 1);
        });

        it("A user buys and locks 100 times and then unlocks", async() => {
            for (let i = 0; i < 100; i++) {
                await buyNLock(user1, 0.1);
            }

            await unlockBoughtTokens(user1, 6.81, 100);
        });

        it("Testing external reverts", async() => {
            contract = contract.connect(user1);
            sellingToken = sellingToken.connect(user1);
            const deadline = await getDeadline();

            await expect(contract.buyNLock(0, 0, 0)).to.be.revertedWith("UniswapV2Router: EXPIRED");  
            await expect(contract.buyNLock(0, 0, deadline)).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT");  
            await expect(contract.buyNLock(parseUnits("1", 0), parseUnits("0", 1), deadline)).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
            await sellingToken.approve(contract.address, parseUnits("1", 0));
            await expect(contract.buyNLock(parseUnits("1", 0), parseUnits("1", 1), deadline)).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        });
    });
});
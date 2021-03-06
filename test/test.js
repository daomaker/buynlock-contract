const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");
const IUniswapV2Router = require("@uniswap/v2-periphery/build/IUniswapV2Router02.json");

describe("BuyNLock smart contract", function() {
    this.timeout(30000);
    let owner, user1, user2, user3, contract, buyingToken, sellingToken, uniswapRouter, swapPathERC20, swapPathETH;

    let lockTime = 60 * 60 * 24 * 10; // 10 days
    const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const sellingTokenDecimals = 6;
    const buyingTokenDecimals = 18;
    const PRECISION_LOSS = "10000000000000000";
    const MAX_LOCK_TIME = 60 * 60 * 24 * 30;
    const WETH = "0xd0A1E359811322d97991E03f863a0C30C2cF029C";
    
    const parseUnits = (value, type = 0) => {
        let decimals;
        if (type == 0) {
            decimals = sellingTokenDecimals;
        } else if (type == 1) {
            decimals = buyingTokenDecimals;
        } else if (type == 2) {
            decimals = 18;
        }

        return ethers.utils.parseUnits(value.toString(), decimals);
    }
    
    const getDeadline = async () => {
        return await time.latest() + 300;
    }
    
    const getAmountOut = async (amountIn, swapPath) => {
        const amountsOut = await uniswapRouter.getAmountsOut(amountIn, swapPath);
        return amountsOut[amountsOut.length - 1];
    }

    const buyForERC20 = async (user, amountToSell, swapPath = swapPathERC20) => {
        contract = contract.connect(user);

        const balance1OfContractBefore = await buyingToken.balanceOf(contract.address);
        const balance0OfUserBefore = await sellingToken.balanceOf(user.address);
        const userLockedAmountBefore = await contract.getLockedAmount(user.address);

        amountToSell = parseUnits(amountToSell, 0);
        const minAmountToBuy = await getAmountOut(amountToSell, swapPath);
        const deadline = await getDeadline();

        sellingToken = sellingToken.connect(user);
        await sellingToken.approve(contract.address, amountToSell);
        await contract.buyForERC20(amountToSell, minAmountToBuy, swapPath, deadline);
        
        const balance1OfContractAfter = await buyingToken.balanceOf(contract.address);
        const balance0OfUserAfter = await sellingToken.balanceOf(user.address);
        const userLockedAmountAfter = await contract.getLockedAmount(user.address);

        expect(balance1OfContractAfter).to.equal(balance1OfContractBefore.add(minAmountToBuy));
        expect(balance0OfUserAfter).to.equal(balance0OfUserBefore.sub(amountToSell));
        expect(userLockedAmountAfter).to.equal(userLockedAmountBefore.add(minAmountToBuy));
    }

    const buyForETH = async (user, amountToSell, swapPath = swapPathETH) => {
        contract = contract.connect(user);

        const balance1OfContractBefore = await buyingToken.balanceOf(contract.address);
        const balance0OfUserBefore = ethers.BigNumber.from(await web3.eth.getBalance(user.address));
        const userLockedAmountBefore = await contract.getLockedAmount(user.address);

        amountToSell = parseUnits(amountToSell, 2);
        const minAmountToBuy = await getAmountOut(amountToSell, swapPath);
        const deadline = await getDeadline();

        await contract.buyForETH(minAmountToBuy, swapPath, deadline, { value: amountToSell });
        
        const balance1OfContractAfter = await buyingToken.balanceOf(contract.address);
        const balance0OfUserAfter = ethers.BigNumber.from(await web3.eth.getBalance(user.address));
        const userLockedAmountAfter = await contract.getLockedAmount(user.address);

        expect(balance1OfContractAfter).to.equal(balance1OfContractBefore.add(minAmountToBuy));
        expect(balance0OfUserAfter).to.closeTo(balance0OfUserBefore.sub(amountToSell), PRECISION_LOSS);
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

        await expect(contract.unlockBoughtTokens(user.address)).to.be.revertedWith("No unlockable amount");
    }

    const multiUnlockBoughtTokens = async (users, expectedUnlockableAmounts, expectedUnlocksCounts) => {
        contract = contract.connect(owner);
        expectedUnlockableAmounts = expectedUnlockableAmounts.map((value) => parseUnits(value, 1));

        const balance1OfContractBefore = await buyingToken.balanceOf(contract.address);
        const balance1OfUserBefore = [];
        const userLockedAmountBefore = []
        const unlockableAmounts = [];
        let unlockableAmountTotal = ethers.BigNumber.from("0");

        for (const i in users) {
            const user = users[i];
            balance1OfUserBefore.push(await buyingToken.balanceOf(user.address));
            userLockedAmountBefore.push(await contract.getLockedAmount(user.address));

            const unlockableAmount = await contract.getUnlockableAmount(user.address);
            expect(unlockableAmount[0]).to.closeTo(expectedUnlockableAmounts[i], PRECISION_LOSS);
            expect(unlockableAmount[1]).to.equal(expectedUnlocksCounts[i]);
            unlockableAmounts.push(unlockableAmount);
            unlockableAmountTotal = unlockableAmountTotal.add(unlockableAmount[0]);
        }

        const userAddresses = users.map((user) => user.address);
        await contract.multiUnlockBoughtTokens(userAddresses);

        const balance1OfContractAfter = await buyingToken.balanceOf(contract.address);
        expect(balance1OfContractAfter).to.equal(balance1OfContractBefore.sub(unlockableAmountTotal));
        for (const i in users) {
            const user = users[i];
            const balance1OfUserAfter = await buyingToken.balanceOf(user.address);
            const userLockedAmountAfter = await contract.getLockedAmount(user.address);
            
            expect(balance1OfUserAfter).to.equal(balance1OfUserBefore[i].add(unlockableAmounts[i][0]));
            expect(userLockedAmountAfter).to.equal(userLockedAmountBefore[i].sub(unlockableAmounts[i][0]));

            await expect(contract.unlockBoughtTokens(user.address)).to.be.revertedWith("No unlockable amount");
        }
    }

    before(async () => {
        [owner, user1, user2, user3] = await ethers.getSigners();

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        sellingToken = await ERC20Mock.deploy("MOCK1", "MOCK1", owner.address, parseUnits("2000", 0), sellingTokenDecimals);
        buyingToken = await ERC20Mock.deploy("MOCK2", "MOCK2", owner.address, parseUnits("2000", 1), buyingTokenDecimals);
        swapPathERC20 = [sellingToken.address, buyingToken.address];
        swapPathETH = [WETH, buyingToken.address];

        await sellingToken.approve(uniswapRouterAddress, parseUnits("1000", 0));
        await buyingToken.approve(uniswapRouterAddress, parseUnits("1000", 1));

        const userSellAmount = parseUnits("200", 0);
        const userBuyAmount = parseUnits("200", 1);
        await sellingToken.transfer(user1.address, userSellAmount);
        await sellingToken.transfer(user2.address, userSellAmount);
        await sellingToken.transfer(user3.address, userSellAmount);
        await buyingToken.transfer(user1.address, userBuyAmount);
        await buyingToken.transfer(user2.address, userBuyAmount);
        await buyingToken.transfer(user3.address, userBuyAmount);

        uniswapRouter = new ethers.Contract(uniswapRouterAddress, IUniswapV2Router.abi, owner);
        await uniswapRouter.addLiquidity( // MOCK1 - MOCK2
            sellingToken.address,
            buyingToken.address,
            parseUnits("500", 0),
            parseUnits("500", 1),
            parseUnits("500", 0),
            parseUnits("500", 1),
            owner.address,
            await getDeadline()
        );

        await uniswapRouter.addLiquidityETH( // ETH - MOCK2
            buyingToken.address,
            parseUnits("500", 1),
            parseUnits("500", 2),
            parseUnits("500", 1),
            owner.address,
            await getDeadline(),
            { value: parseUnits("500", 2) }
        );

        await uniswapRouter.addLiquidityETH( // ETH - MOCK1
            sellingToken.address,
            parseUnits("500", 0),
            parseUnits("500", 2),
            parseUnits("500", 0),
            owner.address,
            await getDeadline(),
            { value: parseUnits("500", 2) }
        );
    });

    it("Deploys BuyNLock contract", async () => {
        const Contract = await ethers.getContractFactory("BuyNLock");
        contract = await Contract.deploy(buyingToken.address, lockTime, uniswapRouterAddress);

        expect(await contract.owner()).to.equal(owner.address);
        expect(await contract.lockTime()).to.equal(lockTime);
        expect(await contract.uniswapRouter()).to.equal(uniswapRouterAddress);
        expect(await contract.buyingToken()).to.equal(buyingToken.address);
    });

    describe("Function visibility", async() => {
        it("Fails to call internal functions", async() => {
            contract = contract.connect(user1);
            expect(contract._lockBoughtTokens).to.equal(undefined);
            expect(contract._unlockBoughtTokens).to.equal(undefined);
        });
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
            await expect(contract.buyForERC20(parseUnits("5", 0), 0, swapPathERC20, await getDeadline())).to.be.revertedWith("Pausable: paused");
            await expect(contract.buyForETH(0, swapPathERC20, await getDeadline(), { value: parseUnits("5", 2) })).to.be.revertedWith("Pausable: paused");

            contract = contract.connect(owner);
            await contract.unpause();
        });
    });

    describe("Buying and unlocking (ERC20 version)", async() => {
        it("Users buy and lock - day 0", async() => {
            await buyForERC20(user1, 10);
            await buyForERC20(user2, 10);
            await buyForERC20(user3, 10);
        });

        it("Users buy and lock - day 1", async() => {
            await time.increase(time.duration.days(1));
            await buyForERC20(user1, 10);
            await buyForERC20(user2, 10);
            await buyForERC20(user3, 10);
        });

        it("Users buy and lock - day 3", async() => {
            await time.increase(time.duration.days(2));
            await buyForERC20(user1, 10);
            await buyForERC20(user2, 10);
            await buyForERC20(user3, 10);
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

        it("The contract has no locked tokens by now", async() => {
            expect(await buyingToken.balanceOf(contract.address)).to.equal(0);
        });

        it("A user is able to unlock instantly after the owner setting lockTime to zero and pausing the contract", async() => {
            await buyForERC20(user1, 10);
            
            contract = contract.connect(owner);
            await contract.setLockTime(0);
            await contract.pause();

            await unlockBoughtTokens(user1, 7.05, 1);

            contract = contract.connect(owner);
            await contract.unpause();
        });

        it("A user buys and locks 100 times and then unlocks", async() => {
            for (let i = 0; i < 100; i++) {
                await buyForERC20(user1, 0.1);
            }
            await unlockBoughtTokens(user1, 6.81, 100);
        });

        it("Testing invalid parameters reverts", async() => {
            contract = contract.connect(user1);
            sellingToken = sellingToken.connect(user1);
            const deadline = await getDeadline();
             
            await expect(contract.buyForERC20(0, 0, swapPathERC20, 0)).to.be.revertedWith("UniswapV2Router: EXPIRED");  
            await expect(contract.buyForERC20(0, 0, swapPathERC20, deadline)).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT");  
            await expect(contract.buyForERC20(parseUnits("1", 0), parseUnits("0", 1), swapPathERC20, deadline)).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
            await sellingToken.approve(contract.address, parseUnits("1", 0));
            await expect(contract.buyForERC20(parseUnits("1", 0), parseUnits("1", 1), swapPathERC20, deadline)).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
            await expect(contract.buyForERC20(parseUnits("1", 0), parseUnits("1", 1), [], deadline)).to.be.revertedWith("Invalid path length");
            await expect(contract.buyForERC20(parseUnits("1", 0), 0, [buyingToken.address, buyingToken.address, sellingToken.address], deadline)).to.be.revertedWith("Invalid token out");
            await expect(contract.buyForERC20(parseUnits("1", 0), 0, [buyingToken.address, sellingToken.address, buyingToken.address], deadline)).to.be.revertedWith("selling token == buying token");
        });
    });

    describe("Buying and unlocking with multi claim function (ERC20 version)", async() => {
        before(async() => {
            contract = contract.connect(owner);
            await contract.setLockTime(lockTime);
        });

        it("Users buy and lock - day 0", async() => {
            await buyForERC20(user1, 10);
            await buyForERC20(user2, 10);
            await buyForERC20(user3, 10);
        });

        it("Users buy and lock - day 1", async() => {
            await time.increase(time.duration.days(1));
            await buyForERC20(user1, 10);
            await buyForERC20(user2, 10);
            await buyForERC20(user3, 10);
        });

        it("Users buy and lock - day 3", async() => {
            await time.increase(time.duration.days(2));
            await buyForERC20(user1, 10);
            await buyForERC20(user2, 10);
            await buyForERC20(user3, 10);
        });

        it("Users unlock bought tokens (1 unlock) - day 5", async() => {
            await time.increase(time.duration.days(2));
            await multiUnlockBoughtTokens(
                [user1, user2, user3],
                [6.59, 6.38, 6.18],
                [1, 1, 1]
            );
        });

        it("Users unlock bought tokens (2 unlocks) - day 10", async() => {
            await time.increase(time.duration.days(5));
            await multiUnlockBoughtTokens(
                [user1, user2, user3],
                [11.47, 11.13, 10.81],
                [2, 2, 2]
            );
        });

        it("A user buys and locks after the multi unlock", async() => {
            await buyForERC20(user1, 10);
            await time.increase(time.duration.days(5));
            await unlockBoughtTokens(user1, 5.02, 1);
        })
    });

    describe("Buying and unlocking with multi claim function (ETH version)", async() => {
        it("Users buy and lock - day 0", async() => {
            await buyForETH(user1, 10);
            await buyForETH(user2, 10);
            await buyForETH(user3, 10);
        });

        it("Users buy and lock - day 1", async() => {
            await time.increase(time.duration.days(1));
            await buyForETH(user1, 10);
            await buyForETH(user2, 10);
            await buyForETH(user3, 10);
        });

        it("Users buy and lock - day 3", async() => {
            await time.increase(time.duration.days(2));
            await buyForETH(user1, 10);
            await buyForETH(user2, 10);
            await buyForETH(user3, 10);
        });

        it("Users unlock bought tokens (1 unlock) - day 5", async() => {
            await time.increase(time.duration.days(2));
            await multiUnlockBoughtTokens(
                [user1, user2, user3],
                [9.77, 9.40, 9.04],
                [1, 1, 1]
            );
        });

        it("Users unlock bought tokens (2 unlocks) - day 10", async() => {
            await time.increase(time.duration.days(5));
            await multiUnlockBoughtTokens(
                [user1, user2, user3],
                [16.52, 15.94, 15.38],
                [2, 2, 2]
            );
        });

        it("A user buys and unlocks with both ETH and ERC20", async() => {
            await buyForERC20(user1, 10);
            await buyForETH(user1, 10);
            await time.increase(time.duration.days(5));
            await unlockBoughtTokens(user1, 11.92, 2);
        });

        it("A user buys with 3 tokens in swap path", async() => {
            await buyForERC20(user1, 10, [sellingToken.address, WETH, buyingToken.address]);
            await buyForETH(user1, 10, [WETH, sellingToken.address, buyingToken.address]);
            await time.increase(time.duration.days(5));
            await unlockBoughtTokens(user1, 11.49, 2);
        });

        it("The contract has no locked tokens by now", async() => {
            expect(await buyingToken.balanceOf(contract.address)).to.equal(0);
        });

        it("Testing invalid parameters reverts", async() => {
            contract = contract.connect(user1);
            const deadline = await getDeadline();
             
            await expect(contract.buyForETH(0, swapPathETH, 0, { value: 0 })).to.be.revertedWith("UniswapV2Router: EXPIRED");  
            await expect(contract.buyForETH(0, swapPathETH, deadline, { value: 0 })).to.be.revertedWith("UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT");  
            await expect(contract.buyForETH(parseUnits("1", 1), swapPathETH, deadline, { value: 0 })).to.be.revertedWith("");
            await expect(contract.buyForETH(parseUnits("1", 1), swapPathETH, deadline, { value: parseUnits("1", 2) })).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
            await expect(contract.buyForETH(parseUnits("1", 1), [], deadline, { value: parseUnits("1", 2) })).to.be.revertedWith("Invalid path length");
            await expect(contract.buyForETH(0, [buyingToken.address, buyingToken.address, sellingToken.address], deadline, { value: parseUnits("1", 2) })).to.be.revertedWith("Invalid token out");
            await expect(contract.buyForETH(0, [buyingToken.address, sellingToken.address, buyingToken.address], deadline, { value: parseUnits("1", 2) })).to.be.revertedWith("selling token == buying token");
        });
    });
});
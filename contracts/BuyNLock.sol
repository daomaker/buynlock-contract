//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract BuyNLock is Ownable, Pausable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 constant MAX_LOCK_TIME = 60 * 60 * 24 * 60; // 60 days
    uint256 constant MAX_UNLOCKS_PER_TX = 1000;

    address[] public swapPath;
    uint24 public lockTime;
    IUniswapV2Router02 public uniswapRouter;
    IERC20 public sellingToken;
    IERC20 public buyingToken;

    struct Lock {
        uint128 amount;
        uint48 lockedAt;
    }

    struct User {
        uint128 lockedAmountTotal;
        uint128 indexToUnlock;
        Lock[] locks;
    }

    mapping(address => User) public users;

    event LockTimeChange(uint24 oldLockTime, uint24 newLockTime);
    event BuyAndLock(address indexed user, uint amountSold, uint amountBought, uint lockedAt);
    event Unlock(address indexed user, uint amountUnlocked, uint numberOfUnlocks);

    constructor(address[] memory _swapPath, uint24 _lockTime, IUniswapV2Router02 _uniswapRouter) {
        require(_swapPath.length > 1, "invalid swap path");
        swapPath = _swapPath;
        lockTime = _lockTime;
        uniswapRouter = _uniswapRouter;

        sellingToken = IERC20(_swapPath[0]);
        buyingToken = IERC20(_swapPath[_swapPath.length - 1]);

        sellingToken.safeIncreaseAllowance(address(_uniswapRouter), 2 ** 128);
    }

    function setLockTime(uint24 _lockTime) external onlyOwner {
        require(_lockTime <= MAX_LOCK_TIME, "Lock time > MAX lock time");

        emit LockTimeChange(lockTime, _lockTime);
        lockTime = _lockTime;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function buyNLock(uint256 amountToSell, uint256 minimumAmountToBuy, uint256 swapDeadline) external whenNotPaused {
        sellingToken.safeTransferFrom(msg.sender, address(this), amountToSell);

        uint256[] memory amountsOut = IUniswapV2Router01(uniswapRouter).swapExactTokensForTokens(
            amountToSell, 
            minimumAmountToBuy, 
            swapPath, 
            address(this), 
            swapDeadline
        );
        uint128 amountBought = amountsOut[amountsOut.length - 1].toUint128();

        User storage user = users[msg.sender];
        user.lockedAmountTotal += amountBought;
        user.locks.push(Lock(amountBought, uint48(block.timestamp)));

        emit BuyAndLock(msg.sender, amountToSell, amountBought, block.timestamp);
    }

    function unlockBoughtTokens(address userAddress) external {
        User storage user = users[userAddress];
        (uint128 unlockableAmount, uint128 unlocksCount) = getUnlockableAmount(userAddress);
        require(unlockableAmount > 0, "No unlockable amount");

        user.indexToUnlock += unlocksCount;
        user.lockedAmountTotal -= unlockableAmount;
        buyingToken.safeTransfer(userAddress, unlockableAmount);
        
        emit Unlock(userAddress, unlockableAmount, unlocksCount);
    }

    function getUnlockableAmount(address userAddress) public view returns (uint128, uint128) {
        User storage user = users[userAddress];
        uint128 indexToUnlock = user.indexToUnlock;
        uint256 locksLength = user.locks.length;
        uint128 unlocksCount = 0;
        uint128 unlockableAmount = 0;

        while (indexToUnlock + unlocksCount < locksLength && unlocksCount < MAX_UNLOCKS_PER_TX) {
            Lock storage lock = user.locks[indexToUnlock + unlocksCount];
            if (block.timestamp < lock.lockedAt + lockTime) break;

            unlockableAmount += lock.amount;
            unlocksCount++;
        }

        return (unlockableAmount, unlocksCount);
    }

    function getLockedAmount(address userAddress) public view returns (uint128) {
        return users[userAddress].lockedAmountTotal;
    }
}

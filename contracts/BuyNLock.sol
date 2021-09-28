//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

contract BuyNLock is Ownable, Pausable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 constant MAX_LOCK_TIME = 60 * 60 * 24 * 60; // 60 days
    uint256 constant MAX_UNLOCKS_PER_TX = 100;

    address[] public swapPath;
    uint24 public lockTime;
    IUniswapV2Router01 uniswapRouter;

    struct Lock {
        uint128 amount;
        uint48 lockedAt;
    }

    struct User {
        uint256 indexToUnlock;
        Lock[] locks;
    }

    mapping(address => User) users;

    event LockTimeChange(uint24 oldLockTime, uint24 newLockTime);
    event BuyAndLock(address indexed user, uint amountSold, uint amountBought, uint lockedAt);
    event Unlock(address indexed user, uint amountUnlocked, uint numberOfUnlocks);

    constructor(address[] memory _swapPath, uint24 _lockTime, IUniswapV2Router01 _uniswapRouter) {
        require(_swapPath.length > 1, "invalid swap path");
        swapPath = _swapPath;
        lockTime = _lockTime;
        uniswapRouter = _uniswapRouter;
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
        IERC20 tokenToSell = IERC20(swapPath[0]);
        tokenToSell.safeTransferFrom(msg.sender, address(this), amountToSell);

        uint256[] memory amountsOut = IUniswapV2Router01(uniswapRouter).swapExactTokensForTokens(
            amountToSell, 
            minimumAmountToBuy, 
            swapPath, 
            address(this), 
            swapDeadline
        );
        uint128 amountBought = amountsOut[amountsOut.length - 1].toUint128();

        users[msg.sender].locks.push(
            Lock(
                amountBought,
                uint48(block.timestamp)
            )
        );

        emit BuyAndLock(msg.sender, amountToSell, amountBought, block.timestamp);
    }

    function unlockBoughtTokens(address userAddress) external {
        User storage user = users[userAddress];
        uint256 indexToUnlock = user.indexToUnlock;
        uint256 locksLength = user.locks.length;

        uint256 unlocksCount = 0;
        uint256 amountToUnlock = 0;
        while (indexToUnlock < locksLength && unlocksCount < MAX_UNLOCKS_PER_TX) {
            Lock storage lock = user.locks[indexToUnlock + unlocksCount];
            if (block.timestamp < lock.lockedAt + lockTime) break;

            amountToUnlock += lock.amount;
            unlocksCount++;
        }
        require(amountToUnlock > 0, "No amount to unlock");
        IERC20 tokenToUnlock = IERC20(swapPath[swapPath.length - 1]);

        user.indexToUnlock += unlocksCount;
        tokenToUnlock.safeTransfer(userAddress, amountToUnlock);
        
        emit Unlock(userAddress, amountToUnlock, unlocksCount);
    }
}

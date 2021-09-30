# Brief overview
- A wrapped uninswap swap, instantly locking bought tokens in this SC. To make this useful, the SC is intended to be combined with eg. off-chain rewards. 
- The buying token address is defined by the owner. (only swaps resulting in buying this token are allowed)
- The tokens are locked for X days, X is defined (also changeable) by the owner.
- Anybody can claim (unlock) bought tokens for anybody whose lock time expired, the tokens go directly to the buyers.
- Users can have multiple locks at the same time.

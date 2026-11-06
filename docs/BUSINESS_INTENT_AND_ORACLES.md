# Business Intent and Oracle Foundation

PIE now has a conservative business-intent model and extensible oracle
contract. Intent is extracted from test titles, assertion evidence, and source
locations, but extraction is not treated as proof of business correctness.

Built-in oracles:

- `assertion-preservation`: verifies supplied original/current assertion evidence.
- `execution-success`: verifies that the target execution passed.

Custom application teams can register domain-specific oracles for payments,
orders, permissions, inventory, or other business state. An oracle returns
`verified`, `contradicted`, or `unavailable`; unavailable evidence must never be
silently promoted to verified.

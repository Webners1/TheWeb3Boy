// Daily snapshot job — implemented in a later step. Deliberately exits
// non-zero so a scheduled run fails loudly instead of silently "succeeding"
// with zero rows written (see docs/traps.md, trap 4).
console.error('ingest: not implemented yet');
process.exit(1);

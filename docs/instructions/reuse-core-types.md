# Reuse the core type; don't wrap it

An operational guardrail — kept here in `instructions/` (not `conventions/`) because it must change how the
next line of code gets written, and a rule that has to be *followed while authoring* belongs where the working
process is read, not on the portable-rules shelf that gets skimmed.

**Rule in one line:** pass and reuse the type that already exists; do **not** invent a new
type/interface/alias/one-field "options" object that only renames, forwards, or re-bundles it. A new named
type earns its existence only by (a) naming a genuinely distinct concept or (b) bundling **2+** fields that
recur and travel together — and then it's introduced at the point of real need, not preemptively.

## Why

Every wrapper is a second place to look and a second thing to keep in sync. An interface whose members are a
subset of an existing class, an `options` object holding a single field, a `type X = Y` alias that adds no
meaning — each adds indirection cost with **zero** information. Worse, it *lies*: a distinct name reads as
"something special happens here," so a reader spends attention discovering that nothing does. These are
**ghosts** — entities that forward a core thing under a new name. They drift from what they wrap, they
multiply the surface a change has to touch, and they hide the real dependency behind a placeholder.

This is the existence question that precedes [types-placement.md](../conventions/types-placement.md)'s *placement* question:
that file's promotion test (2+ importers / boundary / family) decides where a type lives **once it should
exist**; this rule decides whether it should exist at all. A type that fails this rule never reaches the
promotion test — it isn't a type, it's a rename.

## How to apply — the smell tests

Delete the new type and pass the core one when any of these hold:

1. **Subset-of-an-existing-type.** An interface whose methods/fields are a subset of a class or type you
   already have → delete it; the caller depends on the real type (narrow with a structural parameter type at
   the call site if you truly need less, but don't *name* the subset).
2. **Bag-of-one.** A `deps`/`options`/`config` object with a single field → pass the field. Add the bag when
   the **second** field arrives, not in anticipation of it.
3. **Pure rename.** A re-export or `type Alias = Core` that adds no constraint or meaning → import/use the
   core name directly.
4. **Injected-wrapper-for-a-real-thing.** An interface invented so a caller can be handed a capability
   *without naming the concrete type* — when the concrete type is already agnostic/shareable, hand it
   directly. (An interface is justified only when it genuinely hides *multiple* possible implementations or a
   boundary the caller must not couple to.)

Conversely, a new type **is** warranted when it names a distinct concept (a domain term, a boundary contract,
a union of real alternatives) or bundles several fields that recur together — introduce it *there*, in the
implementation that needs it, and let the promotion test place it.

## Examples (generic)

- `interface Registrar { register(name, make); unregister(name) }` injected so plugins "don't import the
  concrete registry" — but the registry is already shareable → delete the interface, inject the registry;
  its public `register`/`unregister` *is* the contract.
- `constructor(deps: { registry: Registry })` → `constructor(registry: Registry)`; promote to a `deps` object
  only when a second dependency lands.
- `type UserId = string` with no branding/validation → just `string` (or add real branding if the point is
  type-safety; a bare alias is a ghost).

## Related

- [types-placement.md](../conventions/types-placement.md) — where a type lives once it earns existence (this rule gates
  existence first).
- [consolidation.md](../conventions/consolidation.md) — the duplication sibling: don't multiply *copies*; this rule is
  don't multiply *names*.
- [naming.md](../conventions/naming.md) — the bells test for names that do survive.
</content>

# GraphCalc Lua module API

Lua module systems control three things:

1. Per-recipe parameters such as maximum module slots or maximum Somersloops.
2. The safe UI shown on each recipe node.
3. Recipe behavior, including cycle time, inputs, outputs, probabilities, and dynamic ports.

Scripts run in a sandbox. They cannot create HTML or CSS and cannot access the DOM, files, the network, packages, dynamic code loading, or host-language objects. The UI is built from GraphCalc primitives so it remains safe and visually consistent.

## System script

Every system script returns `system { ... }`:

```lua
return system {
  parameters = {
    parameter.number {
      id = "module_slots",
      label = "Module slots",
      default = 4,
      min = 0,
      max = 16,
      step = 1,
      integer = true
    }
  },

  defaults = {
    enabled = true
  },

  slots = function(ctx)
    return module_bay.slots { count = ctx.parameters.module_slots }
  end,

  node = function(ctx)
    local controls = {}
    for index = 1, ctx.parameters.module_slots do
      local options = { { value = "", label = "Empty" } }
      for _, candidate in ipairs(ctx.modules) do
        options[#options + 1] = { value = candidate.id, label = candidate.name }
      end
      controls[#controls + 1] = ui.dropdown {
        bind = bindings.slot(index),
        options = options
      }
    end
    return ui.row {
      gap = "small",
      children = controls
    }
  end,

  apply = function(ctx)
    return {}
  end
}
```

- `parameters` defines fields shown when a recipe enables the system.
- `defaults` defines initial per-node state.
- `slots(ctx)` defines the authoritative module loadout independently from presentation.
- `node(ctx)` returns one UI primitive tree.
- `apply(ctx)` is optional and returns a list of effects.

## Module script

A module belongs to exactly one system and returns `module { ... }`:

```lua
return module {
  properties = {
    image = "speed1",
    label = "Speed 1",
    speed_bonus = 0.2
  },

  apply = function(ctx)
    return {
      fx.cycle_time.divide(1 + ctx.properties.speed_bonus * ctx.count)
    }
  end
}
```

`ctx.count` is the number of copies installed in the current node. `properties` is an arbitrary JSON-like table owned by the module. The owning system receives it and decides whether a field means an image, label, tier, color category, mathematical contribution, or nothing at all.

GraphCalc assigns no meaning to property names. This is entirely valid:

```lua
properties = {
  texture = "speed1",
  short_text = "S1",
  contributions = {
    speed = 0.2,
    energy = 0.5
  }
}
```

One system can render `candidate.properties.texture` as an image:

```lua
ui.icon { resource = candidate.properties.texture }
```

Another system can ignore it and render text:

```lua
ui.label { text = candidate.properties.short_text or ("Mod " .. index) }
```

System behavior can also aggregate mathematical properties across installed slots. Module `apply(ctx)` receives the same table as `ctx.properties`.

## System image resources

The system editor has a Resources section for PNG, JPEG, and WebP images. Images are stored in the existing project `images` collection. Every system resource has an editable label and a stable ID. GraphCalc does not assign an icon field to modules. A module may expose a resource label or ID in any property, and its owning system decides whether to render it.

`ui.icon { resource = candidate.properties.image }` resolves an exact stable ID first and then an exact editable label. This means `image = "Speed1"` selects the resource labeled `Speed1`, even when the uploaded filename generated a different ID. IDs remain useful when a reference must survive later label changes. The same lookup works inside composed buttons and popups and for `empty_resource` on the optional module-slot shortcut. Resource data is carried through project copy, JSON export, guest/account synchronization, and workspace merge.

## Context

Both `node(ctx)` and `apply(ctx)` receive:

```lua
ctx.state       -- per-node values bound by UI controls
ctx.slots       -- installed module IDs
ctx.parameters  -- values configured on this recipe
ctx.modules     -- enabled child modules: { id, name, description, properties }
ctx.resources   -- system image resources: { id, name }
ctx.recipe      -- current effective recipe
```

Module `apply` callbacks also receive:

```lua
ctx.count       -- installed copies of this module
ctx.properties  -- this module's own properties table
```

Property values may contain strings, finite numbers, booleans, `nil`, arrays, and nested string-keyed tables. Functions and host objects are not allowed. Property data is depth- and size-limited.

The recipe value uses readable snake-case fields:

```lua
ctx.recipe.id
ctx.recipe.name
ctx.recipe.time_seconds
ctx.recipe.inputs[i].id
ctx.recipe.inputs[i].ref_type
ctx.recipe.inputs[i].ref_id
ctx.recipe.inputs[i].amount
ctx.recipe.outputs[i].id
ctx.recipe.outputs[i].item_id
ctx.recipe.outputs[i].amount
ctx.recipe.outputs[i].probability
```

Module effects run first in slot order. The system's optional `apply` callback runs afterwards and sees the already-modified recipe.

## Recipe parameters

```lua
parameter.number { id, label, default, min, max, step, integer, description }
parameter.toggle { id, label, default, description }
parameter.text   { id, label, default, placeholder, description }
parameter.select {
  id = "mode",
  label = "Mode",
  default = "normal",
  options = {
    { value = "normal", label = "Normal" },
    { value = "boost", label = "Boost" }
  }
}
```

Parameters belong to recipes. State belongs to individual graph nodes.

## Layout primitives

Layouts accept child primitives as array entries:

```lua
ui.row {
  gap = "small",
  align = "center",
  ui.label { text = "Clock speed" },
  ui.number { bind = "clock", suffix = "%" }
}
```

Available layouts:

```lua
ui.row { ... }
ui.column { ... }
ui.grid { columns = 3, ... }
ui.group { label = "Advanced", ... }
```

Safe layout options:

- `gap`: `none`, `small`, `medium`, or `large`
- `align`: `start`, `center`, `end`, `stretch`, or `between`
- `tone`: `accent`, `warning`, `danger`, or `muted`

## Display primitives

```lua
ui.label { text = "Two shards required", tone = "accent" }
ui.icon { text = "◆", label = "Power Shard", tone = "accent" }
ui.icon { resource = "power-shard", label = "Power Shard" }
ui.icon { item = "power-shard", label = "Power Shard" }
ui.icon { resource = ctx.modules[1].properties.image }
ui.spacer {}
ui.when(condition, child)
```

Text is rendered as text, never HTML.

## Bindings

Plain string bindings and `bindings.value` address per-node state. `bindings.slot` addresses one module position:

```lua
"clock_percent"                 -- short form for a state value
bindings.value("clock_percent") -- explicit state-value binding
bindings.slot(1)                -- first module slot
```

A slot binding can be used by an ordinary text dropdown. It is not tied to an icon picker:

```lua
ui.dropdown {
  label = "Module 1",
  bind = bindings.slot(1),
  options = {
    { value = "", label = "Empty" },
    { value = "speed-1", label = "Speed module 1" },
    { value = "productivity-1", label = "Productivity module 1" }
  }
}
```

## Input primitives

```lua
ui.number {
  label = "Clock speed",
  bind = "clock_percent",
  min = 1,
  max = 250,
  step = 0.01,
  suffix = "%",
  placeholder = "100"
}

ui.slider {
  bind = "clock_percent",
  min = 1,
  max = 250,
  step = 0.01
}

ui.toggle { label = "Enabled", bind = "enabled" }
ui.counter { label = "Boosters", bind = "boosters", min = 0, max = 4, step = 1 }
ui.text_input { label = "Label", bind = "custom_label", placeholder = "Optional" }
ui.select {
  label = "Mode", bind = "mode",
  options = {
    { value = "normal", label = "Normal" },
    { value = "boost", label = "Boost" }
  }
}

ui.dropdown { label, bind, options } -- explicit dropdown alias
```

Buttons use safe data actions, not callbacks:

```lua
ui.button {
  text = "Reset",
  on_click = actions.set { bind = "clock_percent", value = 100 }
}

actions.increment { bind = "boosters", amount = 1, min = 0, max = 4 }
actions.toggle { bind = "enabled" }
actions.install { slot = 1, module = "speed-1" }
actions.clear_slot { slot = 1 }
```

Buttons can contain other safe primitives, so their content can be text, an icon, or both:

```lua
ui.button {
  square = true,
  size = "small",
  title = "Speed module 1",
  on_click = actions.install { slot = 1, module = "speed-1" },
  ui.icon { resource = "speed1" }
}
```

## Loadout rules

Presentation never grants solver capacity. `slots(ctx)` owns that job:

```lua
slots = function(ctx)
  return module_bay.slots {
    count = ctx.parameters.module_slots
  }
end
```

Restrict individual positions when needed:

```lua
slots = function(ctx)
  return {
    module_bay.slot { slot = 1, modules = { "speed-1", "speed-2" } },
    module_bay.slot { slot = 2, modules = { "productivity-1" } }
  }
end
```

Anything outside this policy is removed before effects are evaluated, regardless of what the UI displays.

## Composable popups

`ui.popup` accepts any safe primitive as its trigger and any safe primitive tree as its content. It does not know anything about modules:

```lua
ui.popup {
  placement = "bottom-start",
  close_on_action = true,
  trigger = ui.button {
    square = true,
    size = "small",
    ui.label { text = "+" }
  },
  content = ui.grid {
    columns = 4,
    ui.button {
      square = true,
      on_click = actions.install { slot = 1, module = "speed-1" },
      ui.icon { resource = "speed1" }
    },
    ui.button {
      text = "Use productivity",
      on_click = actions.install { slot = 1, module = "productivity-1" }
    }
  }
}
```

Popup options:

- `placement`: `bottom-start`, `bottom-end`, `top-start`, `top-end`, `left-start`, or `right-start`
- `open_on`: `click` or `context`
- `close_on_action`: defaults to `true`

This permits icon palettes, text menus, mixed layouts, or unrelated popup interfaces without introducing HTML or CSS injection.

## Optional module conveniences

`ui.module_slot` remains an optional ready-made icon picker. It is useful when that exact interaction is desired, but it is not required:

```lua
local children = {}
for index = 1, ctx.parameters.module_slots do
  children[#children + 1] = ui.module_slot {
    slot = index,             -- one-based index in ctx.slots
    size = "small",          -- small, medium, or large
    picker_columns = 4,
    picker_label = "Choose module",
    resource_property = "image", -- optional property path chosen by this system
    empty_text = "+",
    clear_text = "Empty",
    show_labels = false
  }
end

return ui.row {
  gap = "small",
  children = children
}
```

The owning system's Resources section supplies its images. `resource_property` tells this convenience primitive which module property contains a resource ID; without it, the picker uses generated initials. To restrict the convenience picker itself, provide module IDs:

```lua
ui.module_slot {
  slot = 1,
  modules = { "speed-1", "speed-2", "speed-3" }
}
```

`empty_resource = "empty-slot"` can use a system resource for the unfilled slot artwork. Uploaded resources remain data-only images; Lua receives their stable IDs but never their URLs or bytes.

`ui.module_counter` is a separate optional convenience for a dedicated counted module, such as Somersloops:

```lua
local sloop = ctx.modules[1]

return ui.row {
  ui.icon { text = "◈", label = "Somersloop" },
  ui.module_counter {
    module = sloop.id,
    label = "Somersloops",
    min = 0,
    max = ctx.parameters.max_sloops
  }
}
```

The counter presentation still needs a matching `slots(ctx)` policy. UI and solver rules intentionally remain separate.

## Target-output primitive

`ui.target_output` numerically solves a bound number or slider value:

```lua
ui.target_output {
  label = "Target output rate",
  bind = "target_rate",
  drives = "clock_percent",
  min = 1,
  max = 250,
  step = 0.01,
  suffix = "/s",
  output = "optional-output-port-id"
}
```

If `output` is omitted, the recipe's first output is used.

## Effects

Every effect family supports `add`, `multiply`, `divide`, `set`, and `remove`:

```lua
fx.cycle_time.divide(1.5)
fx.inputs.multiply(0.8)
fx.outputs.multiply(2)
fx.probability.set(1)
```

Target one port or referenced item:

```lua
fx.inputs.multiply { value = 0.5, port = "water-input" }
fx.outputs.add { value = 2, item = "heavy-oil" }
```

Create dynamic ports:

```lua
fx.inputs.create {
  key = "electricity",
  item = "electricity",
  amount = 4,
  merge = true
}

fx.inputs.create {
  key = "fuel",
  tag = "any-fuel",
  amount = 1
}

fx.outputs.create {
  key = "slag",
  item = "slag",
  amount = 0.5,
  probability = 0.25,
  merge = false
}
```

Dynamic-port keys are namespaced by system/module and remain stable node handles.

## Power Shard example

```lua
return system {
  parameters = {
    parameter.number {
      id = "max_shards", label = "Maximum Power Shards",
      default = 2, min = 0, max = 3, step = 1, integer = true
    }
  },

  defaults = { clock_percent = 100 },

  node = function(ctx)
    local maximum = 100 + 50 * ctx.parameters.max_shards
    local shards = math.max(0, math.ceil(((ctx.state.clock_percent or 100) - 100) / 50))
    return ui.column {
      ui.slider { bind = "clock_percent", min = 1, max = maximum, step = 0.01 },
      ui.label { text = tostring(shards) .. " shards required" }
    }
  end,

  apply = function(ctx)
    return {
      fx.cycle_time.divide((ctx.state.clock_percent or 100) / 100)
    }
  end
}
```

## Limits and compatibility

- Use the Lua 5.2-compatible language subset so scripts behave identically in the browser and server runtimes.
- Source is limited to 100,000 characters.
- Each execution is limited to approximately 250,000 VM instructions.
- Returned tables are depth-, entry-, and UI-primitive-limited.
- Unknown primitives and malformed effects are rejected.
- Script errors become node/solver diagnostics and no failed effects are applied.

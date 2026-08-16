export const FACTORIO_SYSTEM_LUA = `return system {
  parameters = {
    parameter.number {
      id = "module_slots",
      label = "Module slots",
      description = "Maximum modules this recipe node accepts.",
      default = 4,
      min = 0,
      max = 16,
      step = 1,
      integer = true
    }
  },

  defaults = {},

  slots = function(ctx)
    return module_bay.slots { count = ctx.parameters.module_slots or 0 }
  end,

  node = function(ctx)
    local function find_module(id)
      for module_index, candidate in ipairs(ctx.modules) do
        if candidate.id == id then return candidate, module_index end
      end
      return nil, nil
    end

    local function module_art(candidate, fallback)
      local properties = candidate.properties or {}
      if type(properties.image) == "string" and properties.image ~= "" then
        return ui.icon { resource = properties.image, label = candidate.name }
      end
      return ui.label { text = properties.label or fallback }
    end

    local slot_buttons = {}
    for index = 1, ctx.parameters.module_slots or 0 do
      local current, current_index = find_module(ctx.slots[index])
      local choices = {
        ui.button {
          square = true,
          size = "medium",
          title = "Empty slot",
          on_click = actions.clear_slot { slot = index },
          ui.label { text = "×", tone = "muted" }
        }
      }
      for module_index, candidate in ipairs(ctx.modules) do
        choices[#choices + 1] = ui.button {
          square = true,
          size = "medium",
          selected = current and current.id == candidate.id,
          title = candidate.name,
          on_click = actions.install { slot = index, module = candidate.id },
          module_art(candidate, "Mod " .. module_index)
        }
      end

      local trigger_content = current
        and module_art(current, "Mod " .. current_index)
        or ui.label { text = "+" }

      slot_buttons[#slot_buttons + 1] = ui.popup {
        placement = "bottom-start",
        close_on_action = true,
        trigger = ui.button {
          square = true,
          size = "small",
          title = current and current.name or ("Module slot " .. index),
          trigger_content
        },
        content = ui.grid {
          columns = 4,
          gap = "small",
          children = choices
        }
      }
    end
    return ui.column {
      gap = "small",
      ui.label { text = "Modules", tone = "accent" },
      ui.row { gap = "small", children = slot_buttons }
    }
  end
}`;

export const SPEED_MODULE_LUA = `return module {
  properties = {
    image = "",
    label = "SPD",
    speed_bonus = 0.5
  },

  apply = function(ctx)
    return {
      fx.cycle_time.divide(1 + ctx.properties.speed_bonus * ctx.count)
    }
  end
}`;

export const PRODUCTIVITY_MODULE_LUA = `return module {
  properties = {
    image = "",
    label = "PRD",
    productivity_bonus = 0.1
  },

  apply = function(ctx)
    return {
      fx.outputs.multiply(1 + ctx.properties.productivity_bonus * ctx.count)
    }
  end
}`;

export const SLOOP_SYSTEM_LUA = `return system {
  parameters = {
    parameter.number {
      id = "max_sloops",
      label = "Maximum Somersloops",
      default = 2,
      min = 0,
      max = 4,
      step = 1,
      integer = true
    }
  },

  defaults = {},

  slots = function(ctx)
    local sloop = nil
    for _, candidate in ipairs(ctx.modules) do
      if candidate.properties.kind == "somersloop" then sloop = candidate break end
    end
    sloop = sloop or ctx.modules[1]
    if not sloop then return {} end
    return module_bay.slots {
      count = ctx.parameters.max_sloops or 0,
      modules = { sloop.id }
    }
  end,

  node = function(ctx)
    local sloop = nil
    for _, candidate in ipairs(ctx.modules) do
      if candidate.properties.kind == "somersloop" then sloop = candidate break end
    end
    sloop = sloop or ctx.modules[1]
    if not sloop then
      return ui.label { text = "Add a Somersloop module to this system.", tone = "warning" }
    end
    local artwork = sloop.properties.image ~= ""
      and ui.icon { resource = sloop.properties.image, label = sloop.name, tone = "accent" }
      or ui.icon { text = "◈", label = sloop.name, tone = "accent" }
    return ui.row {
      align = "center",
      gap = "small",
      artwork,
      ui.module_counter {
        module = sloop.id,
        label = "Somersloops",
        min = 0,
        max = ctx.parameters.max_sloops or 0
      }
    }
  end
}`;

export const SLOOP_MODULE_LUA = `return module {
  properties = {
    kind = "somersloop",
    image = "",
    output_multiplier = 2
  },

  apply = function(ctx)
    return {
      fx.outputs.multiply(ctx.properties.output_multiplier ^ ctx.count)
    }
  end
}`;

export const POWER_SHARD_SYSTEM_LUA = `return system {
  parameters = {
    parameter.number {
      id = "max_shards",
      label = "Maximum Power Shards",
      default = 2,
      min = 0,
      max = 3,
      step = 1,
      integer = true
    }
  },

  defaults = {
    clock_percent = 100,
    target_rate = 0
  },

  node = function(ctx)
    local maximum = 100 + 50 * (ctx.parameters.max_shards or 0)
    local clock = ctx.state.clock_percent or 100
    local shards = math.max(0, math.ceil((clock - 100) / 50))
    return ui.column {
      gap = "small",
      ui.row {
        align = "center",
        ui.label { text = "Clock speed" },
        ui.number {
          bind = "clock_percent",
          min = 1,
          max = maximum,
          step = 0.01,
          suffix = "%"
        }
      },
      ui.slider {
        bind = "clock_percent",
        min = 1,
        max = maximum,
        step = 0.01
      },
      ui.row {
        align = "center",
        ui.icon { text = "◆", label = "Power Shards", tone = "accent" },
        ui.label { text = tostring(shards) .. " / " .. tostring(ctx.parameters.max_shards or 0) .. " shards required" }
      },
      ui.target_output {
        label = "Target output rate",
        bind = "target_rate",
        drives = "clock_percent",
        min = 1,
        max = maximum,
        step = 0.01,
        suffix = "/s"
      }
    }
  end,

  apply = function(ctx)
    return {
      fx.cycle_time.divide((ctx.state.clock_percent or 100) / 100)
    }
  end
}`;

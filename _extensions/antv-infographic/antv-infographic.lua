--[[
antv-infographic: render AntV Infographic (https://github.com/antvis/infographic)
code blocks to images.

    ```{.infographic #fig-growth fig-cap="Growth engine" width="80%"}
    infographic list-row-horizontal-icon-arrow
    data
      ...
    ```

All infographics of a document are rendered by one run of
scripts/render-infographic.js (headless Chrome) and cached in `.antv-cache/`.
]]

local CACHE_DIR = '.antv-cache'
local CLASSES = { 'infographic', 'antv' }
local EXTENSIONS = { svg = '.svg', png = '.png', pdf = '.pdf' }
-- Attributes consumed by the filter; all others go to the image.
local OWN_ATTRIBUTES = { format = true, theme = true, scale = true, ['fig-cap'] = true }

local script_dir = quarto.utils.resolve_path('scripts')
local script_path = pandoc.path.join({ script_dir, 'render-infographic.js' })

local function log(message)
  io.stderr:write('[antv-infographic] ' .. message .. '\n')
end

local function file_exists(name)
  local file = io.open(name, 'r')
  if file then file:close() end
  return file ~= nil
end

local function is_infographic(el)
  for _, class in ipairs(CLASSES) do
    if el.classes:includes(class) then return true end
  end
  return false
end

-- The exported SVG puts its text in <foreignObject>, which only browsers
-- render. So: SVG for HTML, vector PDF for LaTeX and Typst, PNG elsewhere.
local function default_format()
  if quarto.doc.is_format('html') then return 'svg' end
  if quarto.doc.is_format('latex') or quarto.doc.is_format('typst') then return 'pdf' end
  return 'png'
end

local function job_for(el)
  local format = el.attributes['format'] or default_format()
  if not EXTENSIONS[format] then
    log('WARNING: unknown format "' .. format ..
      '", expected svg, png or pdf; using ' .. default_format())
    format = default_format()
  end
  local theme = el.attributes['theme'] or ''
  local scale = tonumber(el.attributes['scale']) or 3
  local key = pandoc.utils.sha1(table.concat({ el.text, format, theme, tostring(scale) }, '|'))
  local out = pandoc.path.join({ CACHE_DIR, key .. EXTENSIONS[format] })
  return {
    content = el.text, format = format, theme = theme, scale = scale,
    out = out, size_file = out .. '.size',
  }
end

local function ensure_dependencies()
  if file_exists(pandoc.path.join({ script_dir, 'node_modules', '@antv', 'infographic', 'package.json' }))
    and file_exists(pandoc.path.join({ script_dir, 'node_modules', 'puppeteer', 'package.json' })) then
    return true
  end
  log('installing Node dependencies (first run only)...')
  local ok, err = pcall(pandoc.system.with_working_directory, script_dir, function()
    pandoc.pipe('npm', { 'install', '--no-audit', '--no-fund' }, '')
  end)
  if not ok then
    log('WARNING: `npm install` failed in ' .. script_dir ..
      '. Node.js 18+ and npm are required.\n' .. tostring(err))
  end
  return ok
end

-- Renders the jobs that are not in the cache; returns the error of each failed one.
local function render(jobs)
  local errors, pending = {}, {}
  for _, job in pairs(jobs) do
    if not file_exists(job.out) then pending[#pending + 1] = job end
  end
  if #pending == 0 then return errors end

  local function fail_all(message)
    for _, job in ipairs(pending) do errors[job.out] = message end
    return errors
  end

  if not ensure_dependencies() then return fail_all('Node dependencies are missing') end
  pandoc.system.make_directory(CACHE_DIR, true)

  local ok, output = pcall(pandoc.pipe, 'node', { script_path }, pandoc.json.encode(pending))
  if not ok then
    log('WARNING: the renderer failed.\n' .. tostring(output))
    return fail_all('the renderer failed')
  end
  local results = pandoc.json.decode(output, false)
  for i, job in ipairs(pending) do
    local result = results[i] or { ok = false, error = 'no result' }
    if result.ok then
      local file = io.open(job.size_file, 'w')
      if file then
        file:write(string.format('%d %d', math.floor(result.width + 0.5), math.floor(result.height + 0.5)))
        file:close()
      end
    else
      errors[job.out] = result.error or 'unknown error'
    end
  end
  return errors
end

local function natural_width(job)
  local file = io.open(job.size_file, 'r')
  if not file then return nil end
  local width = file:read('n')
  file:close()
  return width
end

local function image_for(el, job)
  local attributes = {}
  for name, value in pairs(el.attributes) do
    if not OWN_ATTRIBUTES[name] then attributes[name] = value end
  end
  -- Without an explicit size, show the infographic at its natural size: a PNG
  -- is `scale` times larger than that in pixels. A PDF already carries its
  -- size, and LaTeX and Typst then shrink it to the line width when needed.
  if job.format ~= 'pdf' and not attributes['width'] and not attributes['height'] then
    local width = natural_width(job)
    if width then attributes['width'] = width .. 'px' end
  end

  local caption = {}
  local fig_cap = el.attributes['fig-cap']
  if fig_cap and fig_cap ~= '' then
    caption = pandoc.utils.blocks_to_inlines(pandoc.read(fig_cap, 'markdown').blocks)
  end
  local classes = el.classes:filter(function(class) return class ~= 'antv' end)
  -- A paragraph holding only a captioned image is a figure.
  return pandoc.Para({
    pandoc.Image(caption, job.out, '', pandoc.Attr(el.identifier, classes, attributes)),
  })
end

function Pandoc(doc)
  local jobs = {}
  doc.blocks:walk({
    CodeBlock = function(el)
      if is_infographic(el) then
        local job = job_for(el)
        jobs[job.out] = job
      end
    end,
  })
  if next(jobs) == nil then return nil end

  local errors = render(jobs)
  doc.blocks = doc.blocks:walk({
    CodeBlock = function(el)
      if not is_infographic(el) then return nil end
      local job = job_for(el)
      if errors[job.out] or not file_exists(job.out) then
        log('WARNING: could not render an infographic (' ..
          (errors[job.out] or 'no output') .. '); leaving it as a code block.')
        return nil
      end
      return image_for(el, job)
    end,
  })
  return doc
end

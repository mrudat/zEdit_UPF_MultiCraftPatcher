/* eslent-env node */
/* global xelib, registerPatcher, patcherUrl, info */
// ngapp is global but unused.

const {
  AddCondition,
  AddItem,
  EditorID,
  FileByName,
  FullName,
  GetElement,
  GetElements,
  GetGoldValue,
  GetIntValue,
  GetLinksTo,
  GetScript,
  GetScriptProperty,
  GetValue,
  GetWeight,
  HasElement,
  LongName,
  SetElement,
  SetGoldValue,
  SetIntValue,
  SetLinksTo,
  SetValue,
  SetWeight,
  Signature
} = xelib

function recordChest (map, item, count, chest) {
  let foo = map.get(item)
  if (!foo) {
    foo = new Map()
    map.set(item, foo)
  }
  foo.set(count, chest)
}

function findChest (map, item, count) {
  const foo = map.get(item)
  if (!foo) {
    return undefined
  }
  return foo.get(count)
}

const forbiddenWorkbenchKeywords = [
  [
    'Skyrim.esm',
    [
      'CraftingSmithingSharpeningWheel',
      'CraftingSmithingArmorTable'
    ]
  ],
  [
    'Complete Crafting Overhaul_Remade.esp',
    [
      'CraftingDisabledRecipe_CCO'
    ]
  ]
]
// 'DLC2StaffEnchanter'?

const editTable = [
  [/Weapon/, ''],
  [/^DLC[0-9](.*)Weapon/, '$1'],
  [/^DLC[0-9]/, ''],
  [/Ingot([A-Z][a-z]*)(x|[A-Z])/, '$1Ingot$2'],
  [/^RecipeIngotDwarven(.*)x([0-9]+Chest)/, 'RecipeDwarvenIngotx$2$1'],
  [/^SkyforgeSteel/, 'Skyforge'],
  [/^StaffTemplate(.*)/, '$1Staff'],
  [/^DLC[12]RecipeArrow([A-Z][a-z]*)x/, 'Recipe$1Arrowx'],
  [/^DLC1RecipeTechBolt([A-Z][a-z]*)(Exploding(.*))?/, 'Recipe$1Bolt$2'],
  [/^DLC1RecipeTech([A-Z][a-z]*)Crossbow(Enhanced)?/, 'Recipe$1Crossbow$2'],
  ['weap', ''],
  ['Axe01', 'WoodcuttersAxe'],
  ['AkaviriKatana', 'BladesSword'],
  ['DLC1DawngardAxe', 'DawnguardWarAxe'],
  ['DLC1DawngardHammer', 'DawnguardWarhammer'],
  ['DraugrBattleAxeHoned', 'HonedAncientNordBattleaxe'],
  ['DraugrBattleAxe', 'AncientNordBattleaxe'],
  ['DraugrBowSupple', 'SuppleAncientNordBow']
]// crossbow

const chestSizes = [
  10,
  100,
  1000
]

registerPatcher({
  info: info,
  gameModes: [xelib.gmTES5, xelib.gmSSE],
  requiredFiles: ['Skyrim.esm', 'MultiCraft.esp'],
  settings: {
    label: info.name,
    templateUrl: `${patcherUrl}/partials/settings.html`,
    defaultSettings: {
      patchFileName: 'zPatch.esp'
    }
  },
  execute: (patchFile, helpers, settings, locals) => ({
    initialize: function () {
      const skyrimEsm = FileByName('Skyrim.esm')

      locals.ironIngot = GetValue(GetElement(skyrimEsm, 'IngotIron'), 'Record Header\\FormID')

      locals.firewood = GetValue(GetElement(skyrimEsm, 'Firewood01'), 'Record Header\\FormID')

      const forbiddenWorkbenchFormIDs = new Set()
      for (const data of forbiddenWorkbenchKeywords) {
        const master = data[0]
        const kywds = data[1]
        const masterFile = FileByName(master)
        if (masterFile === 0) continue
        for (const kywd of kywds) {
          const foo = GetElement(masterFile, kywd)
          if (foo === 0) {
            helpers.logMessage(`Couldn't find ${master}\\${kywd}?`)
            continue
          }
          forbiddenWorkbenchFormIDs.add(GetValue(foo, 'Record Header\\FormID'))
        }
      }

      let templateChest
      const chestsByObject = locals.chestsByObject = new Map()
      for (const chest of helpers.loadRecords('MISC', false)) {
        const script = GetScript(chest, 'MultiCraftScript')
        if (!script) continue
        const item = GetValue(GetScriptProperty(script, 'ItemToAdd'), 'Value\\Object Union\\Object v2\\FormID')
        const count = GetIntValue(GetScriptProperty(script, 'AmountToAdd'), 'Value')
        recordChest(chestsByObject, item, count, chest)
        if (!templateChest) templateChest = chest
      }

      locals.templateChest = templateChest

      const recipesByEditorID = new Map()
      const recipes = helpers.loadRecords('COBJ', false)
      for (const recipe of recipes) {
        const editorID = EditorID(recipe)
        if (!editorID.endsWith('0Chest')) continue
        recipesByEditorID.set(editorID.toLowerCase(), recipe)
      }

      locals.recipesByEditorID = recipesByEditorID
      locals.forbiddenWorkbenchFormIDs = forbiddenWorkbenchFormIDs
    },
    process: [
      {
        load: {
          signature: 'COBJ',
          filter: function (cobj) {
            const editorID = EditorID(cobj)
            if (editorID.startsWith('BYOHHouse')) return false
            if (editorID.includes('CCO_Learn')) return false
            if (editorID.startsWith('CCO_Menu')) return false
            if (editorID.startsWith('CCF_Option')) return false
            if (editorID.endsWith('0Chest')) return false

            const createdObject = GetLinksTo(cobj, 'CNAM')
            if (!createdObject) return false

            const objectName = GetValue(createdObject, 'FULL')
            if (objectName.match(/\[[^\]]*$/)) {
              helpers.logMessage(`Skipping ${LongName(cobj)} as target object ${LongName(createdObject)} contains an unbalanced '['`)
              return false
            }

            if (!HasElement(cobj, 'Items')) return false

            const createdObjectEDID = EditorID(createdObject)
            if (createdObjectEDID.endsWith('0Chest')) return false

            const workbench = GetValue(cobj, 'BNAM')
            if (locals.forbiddenWorkbenchFormIDs.has(workbench)) return false

            const vmad = GetElement(createdObject, 'VMAD')
            if (vmad) {
              const scripts = GetElements(vmad, 'Scripts')
              for (const script of scripts) {
                const scriptName = GetValue(script, 'scriptName')
                switch (scriptName) {
                  case 'CCO_CraftTorch':
                  case 'CCO_SubCraftingArmor':
                  case 'CCO_SubCraftingItem':
                    break
                  default:
                    helpers.logMessage(`[WARN] ${LongName(cobj)} might need to have support added for ${scriptName}`)
                }
              }
            }

            return true
          }
        },
        patch: function (cobj) {
          helpers.logMessage(`Deriving new crafting recipies from ${LongName(cobj)}`)

          let createdObject = GetLinksTo(cobj, 'CNAM')
          let objectCount = GetIntValue(cobj, 'NAM1')

          const vmad = GetElement(createdObject, 'VMAD')
          if (vmad) {
            const scripts = GetElements(vmad, 'Scripts')
            for (const script of scripts) {
              const scriptName = GetValue(script, 'scriptName')
              switch (scriptName) {
                case 'CCO_CraftTorch':
                  createdObject = GetLinksTo(GetScriptProperty(script, 'Torch'), 'Value\\Object Union\\Object v2\\FormID')
                  objectCount = GetIntValue(GetScriptProperty(script, 'NumberCreated'), 'Value')
                  break
                case 'CCO_SubCraftingArmor':
                  createdObject = GetLinksTo(GetScriptProperty(script, 'CraftedObject'), 'Value\\Object Union\\Object v2\\FormID')
                  objectCount = GetIntValue(GetScriptProperty(script, 'NumberCreated'), 'Value')
                  break
                case 'CCO_SubCraftingItem':
                  createdObject = GetLinksTo(GetScriptProperty(script, 'CraftedObject'), 'Value\\Object Union\\Object v2\\FormID')
                  objectCount = GetIntValue(GetScriptProperty(script, 'ItemCount'), 'Value')
                  break
                default:
              }
            }
          }

          if (objectCount === 0) {
            helpers.logMessage('[ERROR] Recipe creates no items!?')
            return
          }

          const foobar = GetValue(createdObject, 'Record Header\\FormID')
          const createdObjectEDID = EditorID(createdObject)
          const objectName = FullName(createdObject)
          const createdObjectSignature = Signature(createdObject)

          let objectValue
          let objectWeight

          switch (createdObjectSignature) {
            case 'ALCH':
              objectValue = GetValue(createdObject, 'ENIT\\Value')
              objectWeight = GetValue(createdObject, 'DATA')
              break
            default:
              objectValue = GetGoldValue(createdObject)
              objectWeight = GetWeight(createdObject)
          }

          const baseRecipeEDID = EditorID(cobj)

          const {
            chestsByObject,
            recipesByEditorID,
            templateChest,
            ironIngot,
            firewood
          } = locals

          for (const multiplier of chestSizes) {
            const quantity = objectCount * multiplier
            const miscEDID = `${createdObjectEDID}x${quantity}Chest`
            const recipeEDID = `${baseRecipeEDID}x${quantity}Chest`

            let miscObject = findChest(chestsByObject, foobar, quantity)
            if (miscObject) {
              helpers.logMessage(`Using existing chest ${LongName(miscObject)}`)
              miscObject = helpers.copyToPatch(miscObject, false)
              SetValue(miscObject, 'EDID', miscEDID)
            } else {
              helpers.logMessage(`Creating new chest ${miscEDID}`)

              miscObject = helpers.copyToPatch(templateChest, true)
              // helpers.cacheRecord(miscObject, miscEDID)
              SetValue(miscObject, 'EDID', miscEDID)
              recordChest(chestsByObject, foobar, quantity, miscObject)
            }

            SetValue(miscObject, 'FULL', `${objectName} x${quantity}!`)

            const script = GetScript(miscObject, 'MultiCraftScript')
            SetIntValue(GetScriptProperty(script, 'AmountToAdd'), 'Value', quantity)
            SetLinksTo(GetScriptProperty(script, 'ItemToAdd'), createdObject, 'Value\\Object Union\\Object v2\\FormID')
            SetLinksTo(GetScriptProperty(script, 'Sacrifice'), miscObject, 'Value\\Object Union\\Object v2\\FormID')

            // craftingXP = 3 x itemValue^0.65 + 25
            // craftingXP - 25 = 3 x itemValue^0.65
            // (craftingXP - 25) / 3 = itemValue^0.65
            // itemValue = (craftingXP - 25) / 3)^(1/0.65)

            // TODO limit to best available XP, rather than per-object XP.
            const craftingXP = ((3 * Math.pow(objectValue, 0.65)) + 25) * quantity
            const totalValue = Math.ceil(Math.pow((craftingXP - 25) / 3, 1 / 0.65))

            SetGoldValue(miscObject, totalValue)
            SetWeight(miscObject, (objectWeight * quantity) + 10)

            let recipe
            if (recipesByEditorID.has(recipeEDID.toLowerCase())) {
              recipe = recipesByEditorID.get(recipeEDID.toLowerCase())
              recipe = helpers.copyToPatch(recipe, false)
            } else {
              for (const edit of editTable) {
                const editedEDID = recipeEDID.replace(edit[0], edit[1])
                recipe = recipesByEditorID.get(editedEDID.toLowerCase())
                if (!recipe) continue
                recipe = helpers.copyToPatch(recipe, false)
                SetValue(recipe, 'EDID', recipeEDID)
                recipesByEditorID.delete(editedEDID)
                recipesByEditorID.set(recipeEDID.toLowerCase(), recipe)
                break
              }
              if (!recipe) {
                helpers.logMessage(`Creating new recipe ${recipeEDID}`)

                recipe = helpers.copyToPatch(cobj, true)
                // helpers.cacheRecord(recipe, recipeEDID)
                SetValue(recipe, 'EDID', recipeEDID)
                recipesByEditorID.set(recipeEDID.toLowerCase(), recipe)
              }
            }

            // overwrite recipe\Items with cobj\Items, so it's in a known state.
            SetElement(GetElement(recipe, 'Items'), GetElement(cobj, 'Items'))

            let hasIron = false
            let hasFirewood = false

            const ingredients = new Map()

            for (const cnto of GetElements(recipe, 'Items')) {
              const ingredient = GetValue(cnto, 'CNTO\\Item')
              let newQuantity = GetIntValue(cnto, 'CNTO\\Count') * multiplier
              switch (ingredient) {
                case firewood:
                  hasFirewood = true
                  newQuantity = newQuantity + 2
                  break
                case ironIngot:
                  hasIron = true
                  newQuantity = newQuantity + 1
                  break
                default:
              }
              SetIntValue(cnto, 'CNTO\\Count', newQuantity)
              ingredients.set(ingredient, newQuantity)
            }

            if (!hasIron) {
              AddItem(recipe, ironIngot, '1')
              ingredients.set(ironIngot, 1)
            }

            if (!hasFirewood) {
              AddItem(recipe, firewood, '2')
              ingredients.set(firewood, 2)
            }

            const oldConditions = GetElement(cobj, 'Conditions')
            if (oldConditions) {
              SetElement(GetElement(recipe, 'Conditions'), oldConditions)

              for (const cond of GetElements(recipe, 'Conditions', false)) {
                if (GetValue(cond, 'CTDA\\Type') !== '11000000') continue
                if (GetValue(cond, 'CTDA\\Function') !== 'GetItemCount') continue
                if (GetValue(cond, 'CTDA\\Run On') !== 'Subject') continue
                const ingredient = GetValue(cond, 'CTDA\\Parameter #1')
                const newQuantity = ingredients.get(ingredient)
                if (!newQuantity) {
                  // CCO replicas that depend on having the original item
                  continue
                }
                SetIntValue(cond, 'CTDA\\Comparison Value', newQuantity)
                ingredients.delete(ingredient)
              }
            }

            for (const ingredient of ingredients.keys()) {
              const newQuantity = ingredients.get(ingredient)
              const newCond = AddCondition(recipe, 'GetItemCount', '11000000', newQuantity.toString(), ingredient)
              SetValue(newCond, 'CTDA\\Run On', 'Subject')
            }

            SetLinksTo(recipe, miscObject, 'CNAM - Created Object')
            SetIntValue(recipe, 'NAM1 - Created Object Count', 42)
          }
        }
      }
    ]
  })
})

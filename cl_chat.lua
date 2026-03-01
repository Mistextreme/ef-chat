local chatInputActive = false
local chatInputActivating = false
local chatHidden = true
local chatLoaded = false

RegisterNetEvent('chatMessage')
RegisterNetEvent('chat:addTemplate')
RegisterNetEvent('chat:addMessage')
RegisterNetEvent('chat:addSuggestion')
RegisterNetEvent('chat:addSuggestions')
RegisterNetEvent('chat:removeSuggestion')
-- RegisterNetEvent('chat:clear')
RegisterNetEvent('__cfx_internal:serverPrint')
RegisterNetEvent('_chat:messageEntered')

AddEventHandler('chatMessage', function(author, ctype, text)
    local args = {text}
    if author ~= "" then table.insert(args, 1, author) end
    local ctype = ctype ~= false and ctype or "normal"
    SendNUIMessage({
        type = 'ON_MESSAGE',
        message = {
            template = '<div class="chat-message ' .. ctype ..
                '"><div class="chat-message-body"><strong>{0}:</strong> {1}</div></div>',
            args = {author, text}
        }
    })
end)

AddEventHandler('__cfx_internal:serverPrint', function(msg)
    SendNUIMessage({
        type = 'ON_MESSAGE',
        message = {templateId = 'print', multiline = true, args = {msg}}
    })
end)

AddEventHandler('chat:addMessage', function(message)
    SendNUIMessage({type = 'ON_MESSAGE', message = message})
end)

print('EF-Chat Made By: [EF Development] BlasterSuraj')

AddEventHandler('chat:addSuggestion', function(name, help, params)
    SendNUIMessage({
        type = 'ON_SUGGESTION_ADD',
        suggestion = {name = name, help = help, params = params or nil}
    })
    local hasSlash = string.find(name, '/')
    if hasSlash then
        local nameWithoutSlash = string.gsub(name, '/', '')
        SendNUIMessage({
            type = 'ON_SUGGESTION_ADD',
            suggestion = {
                name = nameWithoutSlash,
                help = help,
                params = params or nil
            }
        })
    end
end)

AddEventHandler('chat:addSuggestions', function(suggestions)
    for _, suggestion in ipairs(suggestions) do
        SendNUIMessage({type = 'ON_SUGGESTION_ADD', suggestion = suggestion})

        local hasSlash = string.find(suggestion.name, '/')
        if hasSlash then
            local nameWithoutSlash = string.gsub(suggestion.name, '/', '')
            SendNUIMessage({
                type = 'ON_SUGGESTION_ADD',
                suggestion = {
                    name = nameWithoutSlash,
                    help = suggestion.help,
                    params = suggestion.params or nil
                }
            })
        end
    end
end)

AddEventHandler('chat:removeSuggestion', function(name)
    SendNUIMessage({type = 'ON_SUGGESTION_REMOVE', name = name})

    local hasSlash = string.find(name, '/')
    if hasSlash then
        local nameWithoutSlash = string.gsub(name, '/', '')
        SendNUIMessage({type = 'ON_SUGGESTION_REMOVE', name = nameWithoutSlash})
    end
end)

AddEventHandler('chat:addTemplate', function(id, html)
    SendNUIMessage({type = 'ON_TEMPLATE_ADD', template = {id = id, html = html}})
end)

RegisterNUICallback('chatResult', function(data, cb)
    chatInputActive = false
    SetNuiFocus(false, false)

    if not data.canceled then
        if data.message:sub(1, 1) == '/' then
            ExecuteCommand(data.message:sub(2))
        else
            ExecuteCommand(data.message:sub(1))
        end
    end

    cb('ok')
end)

-- =====================================================
-- BUG FIX #1: chat:clear usava action="clear" em vez de type='ON_CLEAR'
-- O App.js despacha mensagens por item.type, por isso o handler ON_CLEAR
-- nunca era chamado com a versão anterior.
-- =====================================================
RegisterNetEvent('chat:clear')
AddEventHandler("chat:clear", function()
    SendNUIMessage({
        type = 'ON_CLEAR'
    })
end)

local function refreshCommands()
    if GetRegisteredCommands then
        local registeredCommands = GetRegisteredCommands()
        local suggestions = {}

        for _, command in ipairs(registeredCommands) do
            if IsAceAllowed(('command.%s'):format(command.name)) then
                local hasSlash = string.find(command.name, '/')
                table.insert(suggestions, {name = command.name, help = ''})
                if not hasSlash then
                    table.insert(suggestions, {name = '/' .. command.name, help = ''})
                end
            end
        end

        TriggerEvent('chat:addSuggestions', suggestions)
    end
end

local function refreshThemes()
    local themes = {}

    for resIdx = 0, GetNumResources() - 1 do
        local resource = GetResourceByFindIndex(resIdx)

        if GetResourceState(resource) == 'started' then
            local numThemes = GetNumResourceMetadata(resource, 'chat_theme')

            if numThemes > 0 then
                local themeName = GetResourceMetadata(resource, 'chat_theme')
                local themeData = json.decode(
                    GetResourceMetadata(resource, 'chat_theme_extra') or 'null')

                if themeName and themeData then
                    themeData.baseUrl = 'nui://' .. resource .. '/'
                    themes[themeName] = themeData
                end
            end
        end
    end

    SendNUIMessage({type = 'ON_UPDATE_THEMES', themes = themes})
end

-- =====================================================
-- SETTINGS: Ler configurações guardadas por KVP e enviar à NUI
-- =====================================================
local function loadSettings()
    local position  = GetResourceKvpString('ef_chat_position')  or 'left'
    local bgColor   = GetResourceKvpString('ef_chat_bg_color')   or '#134855'
    local textColor = GetResourceKvpString('ef_chat_text_color') or '#ffffff'

    SendNUIMessage({
        type = 'ON_LOAD_SETTINGS',
        settings = {
            position  = position,
            bgColor   = bgColor,
            textColor = textColor
        }
    })
end

-- NUI Callback: guardar as configurações via KVP (por jogador, persiste entre sessões)
RegisterNUICallback('saveSettings', function(data, cb)
    if data.position  then SetResourceKvp('ef_chat_position',   data.position)  end
    if data.bgColor   then SetResourceKvp('ef_chat_bg_color',   data.bgColor)   end
    if data.textColor then SetResourceKvp('ef_chat_text_color', data.textColor) end
    cb('ok')
end)

-- NUI Callback: o painel de settings foi aberto do lado JS (via botão de engrenagem)
-- Garante que o NUI tem foco para receber inputs do rato e teclado
RegisterNUICallback('openSettings', function(data, cb)
    SetNuiFocus(true, true)
    cb('ok')
end)

-- =====================================================
-- BUG FIX #2: settingsClosed verificava sempre false, false
-- o que removia o foco do NUI mesmo quando o chat input ainda
-- estava ativo. Agora preserva o foco correto conforme o estado.
-- =====================================================
RegisterNUICallback('settingsClosed', function(data, cb)
    if chatInputActive then
        -- Chat ainda aberto: mantém foco de teclado mas sem cursor de rato
        SetNuiFocus(true, false)
    else
        -- Chat fechado: liberta o foco completamente
        SetNuiFocus(false, false)
    end
    cb('ok')
end)

-- =====================================================

AddEventHandler('onClientResourceStart', function(resName)
    Wait(500)
    refreshCommands()
    refreshThemes()
end)

AddEventHandler('onClientResourceStop', function(resName)
    Wait(500)
    refreshCommands()
    refreshThemes()
end)

RegisterNUICallback('loaded', function(data, cb)
    TriggerServerEvent('chat:init')
    refreshCommands()
    refreshThemes()
    chatLoaded = true
    -- Carregar configurações guardadas e enviar para a NUI
    loadSettings()
    cb('ok')
end)

RegisterKeyMapping('chatopen', 'Opens Chat Window', 'keyboard', 't')
RegisterCommand('chatopen', function()
    SetTextChatEnabled(false)
    SetNuiFocus(false, false)
    if not chatInputActive then
        chatInputActive = true
        chatInputActivating = true
        SendNUIMessage({type = 'ON_OPEN'})
    end

    if chatInputActivating then
        SetNuiFocus(true)
        chatInputActivating = false
    end

    if chatLoaded then
        local shouldBeHidden = false

        if IsScreenFadedOut() or IsPauseMenuActive() then
            shouldBeHidden = true
        end

        if (shouldBeHidden and not chatHidden) or
            (not shouldBeHidden and chatHidden) then
            chatHidden = shouldBeHidden

            SendNUIMessage({
                type = 'ON_SCREEN_STATE_CHANGE',
                shouldHide = shouldBeHidden
            })
        end
    end
end)

-- Comando para abrir as definições do chat a partir do jogo
RegisterCommand('chatsettings', function()
    SetNuiFocus(true, true)
    SendNUIMessage({type = 'ON_OPEN_SETTINGS'})
end, false)
RegisterKeyMapping('chatsettings', 'Opens Chat Settings', 'keyboard', '')
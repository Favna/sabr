import { Client, ClientOptions, Message, MessageData, SplitOptions, isTextBasedChannel } from "@klasa/core";
import { Command, CommandOptions, constructCommand } from "./Command";
import { isGuildTextBasedChannel, PermissionsFlags } from "@klasa/core";

class BotClient extends Client {
  /** The default prefix for the bot. Set this by using Client.setDefaultPrefix('!'). */
  prefix = "bot ";
  /** The commands will be stored here for quick and easy access. */
  commands = new Map<string, Command>();

  constructor(token: string, options: ClientOptions) {
    super(options);

    this.token = token;
    this.on("messageCreate", (message) => this.commandHandler(message));
  }

  /** Use this function to set the default bot's prefix. For example, in DMs or if you dont have prefix settings. */
  setDefaultPrefix(prefix: string) {
    this.prefix = prefix;
    return this;
  }

  /** This function can be overriden and set a custom function of your choosing to support custom guild prefixes. So you can fetch the prefix from your database using the message and return the prefix string. Recommended: Save prefixes in cache instead of having to fetch your database on every message. */
  getPrefix(_message: Message) {
    return this.prefix;
  }

  /** This function can be overriden and set a custom function to handle when the bot is mentioned without anything else in there. By default, this will send the prefix. */
  botMentioned(message: Message) {
    // TODO: i18next this crap
    return message.channel.send({ data: { content: `The prefix in this guild is set to: **${this.prefix}**` } });
  }

  /** This function can be overriden and set a custom command handler. Customizing this should only be done by ADVANCED DEVELOPERS! */
  async commandHandler(message: Message) {
    // Commands should never be allowed by bots. That's how you get rate limited/banned.
    if (message.author.bot) return;

    const botMentions = [this.user!.toString(), `<@!${this.user!.id}>`];
    const botMentioned = botMentions.find((mention) => message.content.startsWith(mention));

    // Bot was mentioned without anything else, we should show the prefix
    if (botMentions.includes(message.content)) return this.botMentioned(message);

    const prefix = botMentioned || this.getPrefix(message);
    const [commandName, ...parameters] = message.content.substring(prefix.length).split(" ");
    const command = this.commands.get(commandName);
    if (!command) return;

    if (!message.guild!.me) await message.guild!.members.fetch(this.user!.id);
    if (!this.commandAllowed(message, command)) return;

    // The bot has met all permission checks for the command. Now check if there is a subcommand

    // Parsed args and validated
    const args = this.parseArguments(message, command, parameters) as { [key: string]: any };
    // Some arg that was required was missing and handled already
    if (!args) return;

    // If no subcommand execute the command
    const argument = command.arguments.find((argument) => argument.type === "subcommand");
    if (!argument) return command.execute(message, args);

    // A subcommand was asked for in this command
    const subcommand = command.subcommands.get(args[argument.name]);
    if (!subcommand) return;

    // Check subcommand permissions and options
    if (!this.commandAllowed(message, command)) return;
    // Parse the args and then execute the subcommand
    return subcommand.execute(message, args);
  }

  /** Handles all the checking of command options to see if a command is allowed to execute. You can override this if you wish if you know what you are doing. */
  commandAllowed(message: Message, command: Command) {
    // If the command was triggered in DM it needs separate handling.
    if (!isGuildTextBasedChannel(message.channel)) {
      this.handleDM(message);
      return false;
    }

    // If the bot is not available then we can just cancel out.
    const botMember = message.guild!.me;
    const memberPerms = message.member?.permissions;
    const channelMemberPerms = message.channel.permissionsFor(message.member!);
    const botMemberPerms = botMember!.permissions;
    const channelBotPerms = message.channel.permissionsFor(botMember!);

    // Check if the message author has the necessary channel permissions to run this command
    if (command.requiredChannelPermissions.length) {
      const missingPermissions = command.requiredChannelPermissions.filter((perm) => !channelMemberPerms.has(perm));
      if (missingPermissions.length) {
        this.missingCommandPermission(message, command, missingPermissions, "framework/core:USER_CHANNEL_PERM");
        return false;
      }
    }

    // Check if the message author has the necessary permissions to run this command
    if (command.requiredServerPermissions.length) {
      const missingPermissions = command.requiredServerPermissions.filter((perm) => !memberPerms?.has(perm));
      if (missingPermissions.length) {
        this.missingCommandPermission(message, command, missingPermissions, "framework/core:USER_SERVER_PERM");
        return false;
      }
    }

    // Check if the bot has the necessary channel permissions to run this command in this channel.
    if (command.botChannelPermissions.length) {
      const missingPermissions = command.botChannelPermissions.filter((perm) => !channelBotPerms.has(perm));
      if (missingPermissions.length) {
        this.missingCommandPermission(message, command, missingPermissions, "framework/core:BOT_CHANNEL_PERM");
        return false;
      }
    }

    // Check if the bot has the necessary permissions to run this command
    if (command.botServerPermissions.length) {
      const missingPermissions = command.botServerPermissions.filter((perm) => !botMemberPerms.has(perm));
      if (missingPermissions.length) {
        this.missingCommandPermission(message, command, missingPermissions, "framework/core:BOT_SERVER_PERM");
        return false;
      }
    }

    // Check the commands permission level
    return command.permissionLevel(message);
  }

  /** The command handler when the message is in a DM. This function can be overriden to do custom command handling for dms. */
  handleDM(message: Message) {
    if (!message.content.startsWith(this.prefix)) return;

    const [commandName, ...parameters] = message.content.substring(this.prefix.length).split(" ");
    const command = this.commands.get(commandName);
    if (!command?.dm || !command.permissionLevel(message)) return;

    // Process command or subcommand
    const [argument] = command.arguments;
    if (argument.type === "subcommand") {
      const subcommand = parameters.shift();
      if (!subcommand) return;

      // @ts-ignore
      const callback = command[subcommand];

      return callback(message, parameters);
    }

    return command.execute(message, parameters);
  }

  /** This function can be overriden to handle when a command has a mission permission. */
  missingCommandPermission(
    message: Message,
    command: Command,
    missingPermissions: PermissionsFlags[],
    type:
      | "framework/core:USER_SERVER_PERM"
      | "framework/core:USER_CHANNEL_PERM"
      | "framework/core:BOT_SERVER_PERM"
      | "framework/core:BOT_CHANNEL_PERM"
  ) {
    this.sendMessage(
      message.channel.id,
      // TODO: some translation solution to translate strings
      {
        content: this.translate(type, {
          mention: message.author.toString(),
          command: command.name,
          missingPermissions: missingPermissions.join(", "),
        }),
      }
    );
  }

  /** Will be used to translate strings with i18next */
  translate(key: string, args?: any) {
    // TODO: handle i18next translation crap
    console.log(key, args);
    return "";
  }

  /** Sends a message to a channel by first checking if this channel has permissions for the bot to send a message. */
  sendMessage(channelID: string, data: MessageData, options?: SplitOptions) {
    const channel = this.channels.get(channelID);
    if (!channel || !isTextBasedChannel(channel)) return [];

    if (!isGuildTextBasedChannel(channel)) return channel.send({ data }, options);

    const member = channel.guild.members.get(this.user!.id);
    if (!member) return;

    const perms = channel.permissionsFor(member);
    if (
      ![PermissionsFlags.ViewChannel, PermissionsFlags.SendMessages, PermissionsFlags.EmbedLinks].every((permission) =>
        perms.has(permission)
      )
    )
      return;

    return channel.send({ data }, options);
  }

  /** This function is for parsing arguments. If a required arg is missing it will return false. Customizing this should be only for ADVANCED DEVS! */
  parseArguments(message: Message, command: Command, parameters: string[]) {
    const args: { [key: string]: unknown } = {};
    let missingRequiredArg = false;

    // Clone the parameters so we can modify it without editing original array
    const params = [...parameters];

    // Loop over each argument and validate
    for (const argument of command.arguments) {
      // Subcommands
      if (argument.type === "subcommand") {
        const [subcommand] = params;

        const valid = argument.literals?.find((literal) => literal.toLowerCase() === subcommand.toLowerCase());

        // If a valid subcommand was found
        if (valid) {
          args[argument.name] = valid;
          params.shift();
        } else {
          // If a default subcommand is provided use it.
          if (argument.defaultValue) args[argument.name] = argument.defaultValue;
          else {
            missingRequiredArg = true;
            // Subcommands are always required if requested so we immediately handle and cancel.
            argument.missing?.(message);
            break;
          }
        }

        continue;
      }

      // Number
      if (argument.type === "number") {
        const [number] = params;

        const valid = Number(number);
        if (valid) {
          args[argument.name] = valid;
          params.shift();
        } else {
          if (argument.defaultValue) args[argument.name] = argument.defaultValue;
          else {
            if (argument.required) {
              missingRequiredArg = true;
              argument.missing?.(message);
              break;
            }
          }
        }

        continue;
      }

      if (argument.type === "boolean") {
        const [boolean] = params;

        const valid = ["true", "false", "on", "off"].includes(boolean);
        if (valid) {
          args[argument.name] = ["true", "on"].includes(boolean);
          params.shift();
        } else {
          if (argument.defaultValue) args[argument.name] = argument.defaultValue;
          else {
            if (argument.required) {
              missingRequiredArg = true;
              argument.missing?.(message);
              break;
            }
          }
        }

        continue;
      }

      if (argument.type === "string") {
        const [text] = params;

        const valid =
          // If the argument required literals and some string was provided by user
          argument.literals?.length && text
            ? argument.literals.includes(text.toLowerCase())
              ? text
              : undefined
            : undefined;

        if (valid) {
          args[argument.name] = valid;
          params.shift();
        } else {
          if (argument.defaultValue) args[argument.name] = argument.defaultValue;
          else if (argument.required) {
            missingRequiredArg = true;
            argument.missing?.(message);
            break;
          }
        }
      }
    }

    // If an arg was missing then return false so we can error out as an object {} will always be truthy
    return missingRequiredArg ? false : args;
  }

  /** Use this function to create a command. */
  createCommand(name: string, options: CommandOptions) {
    // Check if this command has already been created
    if (this.commands.has(name.toLowerCase())) throw new Error(`Command with the name ${name} already exists.`);

    // Create the command and add it to the cache.
    this.commands.set(name.toLowerCase(), constructCommand(name, options));
  }

  /** Use this function to create a subcommand. */
  createSubcommand(commandName: string, subcommandName: string, options: CommandOptions) {
    // Check if the main command has been created.
    const command = this.commands.get(commandName.toLowerCase());
    if (!command) throw new Error(`To create the ${subcommandName}, you must first create the main ${commandName}.`);

    // Check if this subcommand already exists
    if (command.subcommands.has(subcommandName.toLowerCase()))
      throw new Error(`The ${subcommandName} already exists in the ${commandName}`);

    command.subcommands.set(subcommandName.toLowerCase(), constructCommand(subcommandName, options));
  }
}

export default BotClient;

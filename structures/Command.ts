import { Message, PermissionsFlags } from "@klasa/core";

export interface Argument {
  /** The name of the argument. Useful for when you need to alert the user X arg is missing. */
  name: string;
  /** The type of the argument you would like. Defaults to string. */
  type?: "number" | "string" | "boolean" | "subcommand";
  /** The function that runs if this argument is required and is missing. */
  missing?: (message: Message) => unknown;
  /** Whether or not this argument is required. Defaults to true. */
  required?: boolean;
  /** If the type is string, this will force this argument to be lowercase. */
  lowercase?: boolean;
  /** If the type is string or subcommand you can provide literals. The argument MUST be exactly the same as the literals to be accepted. For example, you can list the subcommands here to make sure it matches. */
  literals?: string[];
  /** The default value for this argument/subcommand. */
  defaultValue?: string | boolean | number
}

export interface CommandOptions {
  /** The command names that can also trigger this command. */
  aliases?: string[];
  /** Whether or not this command can be used in DM. */
  dm?: boolean;
  /** List of modules that you can use to enable/disable certain modules of your bots on a server. */
  modules: string[];
  /** The permission level required to run this command. */
  permissionLevel?: (message: Message) => boolean;
  /** The description of the command. Useful for a help command to provide information on the command. */
  description?: string;
  /** The permissions you want to check if the message author has from their roles. */
  requiredServerPermissions?: PermissionsFlags[];
  /** The permissions you want to check if the message author has in this channel where the command is used. */
  requiredChannelPermissions?: PermissionsFlags[];
  /** The permissions the BOT must have from it's roles. */
  botServerPermissions?: PermissionsFlags[];
  /** The permissions the BOT must have in the current channel. */
  botChannelPermissions?: PermissionsFlags[];
  /** The arguments that a command should have with arg parsing built in. */
  arguments?: Argument[];
  /** The main code that will be run when this command is triggered. */
  execute: (message: Message, parameters: unknown) => unknown;
}

const defaultPermRequired = () => true;

export function constructCommand(name: string, options: CommandOptions) {
  return {
    name: name.toLowerCase(),
    aliases: options.aliases || [],
    arguments: options.arguments || [],
    description: options.description || "DEFAULT_COMMAND_DESCRIPTION",
    dm: options.dm || false,
    modules: options.modules || [],

    permissionLevel: options.permissionLevel || defaultPermRequired,
    requiredChannelPermissions: options.requiredChannelPermissions || [],
    requiredServerPermissions: options.requiredServerPermissions || [],
    botChannelPermissions: options.botChannelPermissions || [],
    botServerPermissions: options.botServerPermissions || [],

    subcommands: new Map<string, Command>(),
    execute: options.execute,
  };
}

export interface Command extends ReturnType<typeof constructCommand> {}

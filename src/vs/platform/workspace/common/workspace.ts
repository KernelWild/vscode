/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { extname } from 'vs/base/common/path';
import { IWorkspaceFolderProvider } from 'vs/base/common/labels';
import { TernarySearchTree } from 'vs/base/common/map';
import { extname as resourceExtname, basenameOrAuthority, joinPath, extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { URI, UriComponents } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

export interface IRawFileWorkspaceFolder {
	path: string;
	name?: string;
}

export interface IRawUriWorkspaceFolder {
	uri: string;
	name?: string;
}

export const IWorkspaceContextService = createDecorator<IWorkspaceContextService>('contextService');

export interface IWorkspaceContextService extends IWorkspaceFolderProvider {

	readonly _serviceBrand: undefined;

	/**
	 * An event which fires on workbench state changes.
	 */
	readonly onDidChangeWorkbenchState: Event<WorkbenchState>;

	/**
	 * An event which fires on workspace name changes.
	 */
	readonly onDidChangeWorkspaceName: Event<void>;

	/**
	 * An event which fires before workspace folders change.
	 */
	readonly onWillChangeWorkspaceFolders: Event<IWorkspaceFoldersWillChangeEvent>;

	/**
	 * An event which fires on workspace folders change.
	 */
	readonly onDidChangeWorkspaceFolders: Event<IWorkspaceFoldersChangeEvent>;

	/**
	 * Provides access to the complete workspace object.
	 */
	getCompleteWorkspace(): Promise<IWorkspace>;

	/**
	 * Provides access to the workspace object the window is running with.
	 * Use `getCompleteWorkspace` to get complete workspace object.
	 */
	getWorkspace(): IWorkspace;

	/**
	 * Return the state of the workbench.
	 *
	 * WorkbenchState.EMPTY - if the workbench was opened with empty window or file
	 * WorkbenchState.FOLDER - if the workbench was opened with a folder
	 * WorkbenchState.WORKSPACE - if the workbench was opened with a workspace
	 */
	getWorkbenchState(): WorkbenchState;

	/**
	 * Returns the folder for the given resource from the workspace.
	 * Can be null if there is no workspace or the resource is not inside the workspace.
	 */
	getWorkspaceFolder(resource: URI): IWorkspaceFolder | null;

	/**
	 * Return `true` if the current workspace has the given identifier or root URI otherwise `false`.
	 */
	isCurrentWorkspace(workspaceIdOrFolder: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI): boolean;

	/**
	 * Returns if the provided resource is inside the workspace or not.
	 */
	isInsideWorkspace(resource: URI): boolean;
}

export interface IResolvedWorkspace extends IWorkspaceIdentifier, IBaseWorkspace {
	folders: IWorkspaceFolder[];
}

export interface IBaseWorkspace {

	/**
	 * If present, marks the window that opens the workspace
	 * as a remote window with the given authority.
	 */
	remoteAuthority?: string;

	/**
	 * Transient workspaces are meant to go away after being used
	 * once, e.g. a window reload of a transient workspace will
	 * open an empty window.
	 *
	 * See: https://github.com/microsoft/vscode/issues/119695
	 */
	transient?: boolean;
}

export interface IBaseWorkspaceIdentifier {

	/**
	 * Every workspace (multi-root, single folder or empty)
	 * has a unique identifier. It is not possible to open
	 * a workspace with the same `id` in multiple windows
	 */
	id: string;
}

/**
 * A single folder workspace identifier is a path to a folder + id.
 */
export interface ISingleFolderWorkspaceIdentifier extends IBaseWorkspaceIdentifier {

	/**
	 * Folder path as `URI`.
	 */
	uri: URI;
}

/**
 * A multi-root workspace identifier is a path to a workspace file + id.
 */
export interface IWorkspaceIdentifier extends IBaseWorkspaceIdentifier {

	/**
	 * Workspace config file path as `URI`.
	 */
	configPath: URI;
}

export interface IEmptyWorkspaceIdentifier extends IBaseWorkspaceIdentifier { }

export type IAnyWorkspaceIdentifier = IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier;

export function isSingleFolderWorkspaceIdentifier(obj: unknown): obj is ISingleFolderWorkspaceIdentifier {
	const singleFolderIdentifier = obj as ISingleFolderWorkspaceIdentifier | undefined;

	return typeof singleFolderIdentifier?.id === 'string' && URI.isUri(singleFolderIdentifier.uri);
}

export function toWorkspaceIdentifier(workspace: IWorkspace): IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | undefined {

	// Multi root
	if (workspace.configuration) {
		return {
			id: workspace.id,
			configPath: workspace.configuration
		};
	}

	// Single folder
	if (workspace.folders.length === 1) {
		return {
			id: workspace.id,
			uri: workspace.folders[0].uri
		};
	}

	// Empty workspace
	return undefined;
}

export function isWorkspaceIdentifier(obj: unknown): obj is IWorkspaceIdentifier {
	const workspaceIdentifier = obj as IWorkspaceIdentifier | undefined;

	return typeof workspaceIdentifier?.id === 'string' && URI.isUri(workspaceIdentifier.configPath);
}

export interface ISerializedSingleFolderWorkspaceIdentifier extends IBaseWorkspaceIdentifier {
	uri: UriComponents;
}

export interface ISerializedWorkspaceIdentifier extends IBaseWorkspaceIdentifier {
	configPath: UriComponents;
}

export function reviveIdentifier(identifier: undefined): undefined;
export function reviveIdentifier(identifier: ISerializedWorkspaceIdentifier): IWorkspaceIdentifier;
export function reviveIdentifier(identifier: ISerializedSingleFolderWorkspaceIdentifier): ISingleFolderWorkspaceIdentifier;
export function reviveIdentifier(identifier: IEmptyWorkspaceIdentifier): IEmptyWorkspaceIdentifier;
export function reviveIdentifier(identifier: ISerializedWorkspaceIdentifier | ISerializedSingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined): IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined;
export function reviveIdentifier(identifier: ISerializedWorkspaceIdentifier | ISerializedSingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined): IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined {

	// Single Folder
	const singleFolderIdentifierCandidate = identifier as ISerializedSingleFolderWorkspaceIdentifier | undefined;
	if (singleFolderIdentifierCandidate?.uri) {
		return { id: singleFolderIdentifierCandidate.id, uri: URI.revive(singleFolderIdentifierCandidate.uri) };
	}

	// Multi folder
	const workspaceIdentifierCandidate = identifier as ISerializedWorkspaceIdentifier | undefined;
	if (workspaceIdentifierCandidate?.configPath) {
		return { id: workspaceIdentifierCandidate.id, configPath: URI.revive(workspaceIdentifierCandidate.configPath) };
	}

	// Empty
	if (identifier?.id) {
		return { id: identifier.id };
	}

	return undefined;
}

export const enum WorkbenchState {
	EMPTY = 1,
	FOLDER,
	WORKSPACE
}

export interface IWorkspaceFoldersWillChangeEvent {
	join(promise: Promise<void>): void;
	readonly changes: IWorkspaceFoldersChangeEvent;
	readonly fromCache: boolean;
}

export interface IWorkspaceFoldersChangeEvent {
	added: IWorkspaceFolder[];
	removed: IWorkspaceFolder[];
	changed: IWorkspaceFolder[];
}

export interface IWorkspace {

	/**
	 * the unique identifier of the workspace.
	 */
	readonly id: string;

	/**
	 * Folders in the workspace.
	 */
	readonly folders: IWorkspaceFolder[];

	/**
	 * Transient workspaces are meant to go away after being used
	 * once, e.g. a window reload of a transient workspace will
	 * open an empty window.
	 */
	readonly transient?: boolean;

	/**
	 * the location of the workspace configuration
	 */
	readonly configuration?: URI | null;
}

export function isWorkspace(thing: unknown): thing is IWorkspace {
	const candidate = thing as IWorkspace | undefined;

	return !!(candidate && typeof candidate === 'object'
		&& typeof candidate.id === 'string'
		&& Array.isArray(candidate.folders));
}

export interface IWorkspaceFolderData {

	/**
	 * The associated URI for this workspace folder.
	 */
	readonly uri: URI;

	/**
	 * The name of this workspace folder. Defaults to
	 * the basename of its [uri-path](#Uri.path)
	 */
	readonly name: string;

	/**
	 * The ordinal number of this workspace folder.
	 */
	readonly index: number;
}

export interface IWorkspaceFolder extends IWorkspaceFolderData {

	/**
	 * Given workspace folder relative path, returns the resource with the absolute path.
	 */
	toResource: (relativePath: string) => URI;
}

export function isWorkspaceFolder(thing: unknown): thing is IWorkspaceFolder {
	const candidate = thing as IWorkspaceFolder;

	return !!(candidate && typeof candidate === 'object'
		&& URI.isUri(candidate.uri)
		&& typeof candidate.name === 'string'
		&& typeof candidate.toResource === 'function');
}

export class Workspace implements IWorkspace {

	private _foldersMap: TernarySearchTree<URI, WorkspaceFolder> = TernarySearchTree.forUris<WorkspaceFolder>(this._ignorePathCasing);
	private _folders!: WorkspaceFolder[];

	constructor(
		private _id: string,
		folders: WorkspaceFolder[],
		private _transient: boolean,
		private _configuration: URI | null,
		private _ignorePathCasing: (key: URI) => boolean,
	) {
		this.folders = folders;
	}

	update(workspace: Workspace) {
		this._id = workspace.id;
		this._configuration = workspace.configuration;
		this._transient = workspace.transient;
		this._ignorePathCasing = workspace._ignorePathCasing;
		this.folders = workspace.folders;
	}

	get folders(): WorkspaceFolder[] {
		return this._folders;
	}

	set folders(folders: WorkspaceFolder[]) {
		this._folders = folders;
		this.updateFoldersMap();
	}

	get id(): string {
		return this._id;
	}

	get transient(): boolean {
		return this._transient;
	}

	get configuration(): URI | null {
		return this._configuration;
	}

	set configuration(configuration: URI | null) {
		this._configuration = configuration;
	}

	getFolder(resource: URI): IWorkspaceFolder | null {
		if (!resource) {
			return null;
		}

		return this._foldersMap.findSubstr(resource.with({
			scheme: resource.scheme,
			authority: resource.authority,
			path: resource.path
		})) || null;
	}

	private updateFoldersMap(): void {
		this._foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(this._ignorePathCasing);
		for (const folder of this.folders) {
			this._foldersMap.set(folder.uri, folder);
		}
	}

	toJSON(): IWorkspace {
		return { id: this.id, folders: this.folders, transient: this.transient, configuration: this.configuration };
	}
}

export class WorkspaceFolder implements IWorkspaceFolder {

	readonly uri: URI;
	name: string;
	index: number;

	constructor(
		data: IWorkspaceFolderData,
		readonly raw?: IRawFileWorkspaceFolder | IRawUriWorkspaceFolder
	) {
		this.uri = data.uri;
		this.index = data.index;
		this.name = data.name;
	}

	toResource(relativePath: string): URI {
		return joinPath(this.uri, relativePath);
	}

	toJSON(): IWorkspaceFolderData {
		return { uri: this.uri, name: this.name, index: this.index };
	}
}

export function toWorkspaceFolder(resource: URI): WorkspaceFolder {
	return new WorkspaceFolder({ uri: resource, index: 0, name: basenameOrAuthority(resource) }, { uri: resource.toString() });
}

export const WORKSPACE_EXTENSION = 'code-workspace';
const WORKSPACE_SUFFIX = `.${WORKSPACE_EXTENSION}`;
export const WORKSPACE_FILTER = [{ name: localize('codeWorkspace', "Code Workspace"), extensions: [WORKSPACE_EXTENSION] }];
export const UNTITLED_WORKSPACE_NAME = 'workspace.json';

export function isUntitledWorkspace(path: URI, environmentService: IEnvironmentService): boolean {
	return extUriBiasedIgnorePathCase.isEqualOrParent(path, environmentService.untitledWorkspacesHome);
}

export function hasWorkspaceFileExtension(path: string | URI) {
	const ext = (typeof path === 'string') ? extname(path) : resourceExtname(path);

	return ext === WORKSPACE_SUFFIX;
}

/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { forwardRef, MutableRefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IInputBoxStyles, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { Checkbox } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { CodeEditorWidget } from '../../../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js'
import { useAccessor } from './services.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';
import { asCssVariable } from '../../../../../../../platform/theme/common/colorUtils.js';
import { inputBackground, inputForeground } from '../../../../../../../platform/theme/common/colorRegistry.js';
import { useFloating, autoUpdate, offset, flip, shift, size, autoPlacement } from '@floating-ui/react';
import { FilePickerMenu } from './FilePickerMenu.js';
import { basename } from '../../../../../../../base/common/resources.js';
import { StagingSelectionItem } from '../../../chatThreadService.js';

// type guard
const isConstructor = (f: any)
	: f is { new(...params: any[]): any } => {
	return !!f.prototype && f.prototype.constructor === f;
}

export const WidgetComponent = <CtorParams extends any[], Instance>({ ctor, propsFn, dispose, onCreateInstance, children, className }
	: {
		ctor: { new(...params: CtorParams): Instance } | ((container: HTMLDivElement) => Instance),
		propsFn: (container: HTMLDivElement) => CtorParams, // unused if fn
		onCreateInstance: (instance: Instance) => IDisposable[],
		dispose: (instance: Instance) => void,
		children?: React.ReactNode,
		className?: string
	}
) => {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const instance = isConstructor(ctor) ? new ctor(...propsFn(containerRef.current!)) : ctor(containerRef.current!)
		const disposables = onCreateInstance(instance);
		return () => {
			disposables.forEach(d => d.dispose());
			dispose(instance)
		}
	}, [ctor, propsFn, dispose, onCreateInstance, containerRef])

	return <div ref={containerRef} className={className === undefined ? `w-full` : className}>{children}</div>
}


export type TextAreaFns = { setValue: (v: string) => void, enable: () => void, disable: () => void }
type InputBox2Props = {
	initValue?: string | null;
	placeholder: string;
	multiline: boolean;
	fnsRef?: { current: null | TextAreaFns };
	className?: string;
	onChangeText?: (value: string) => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
	onChangeHeight?: (newHeight: number) => void;
}
export const VoidInputBox2 = forwardRef<HTMLDivElement, InputBox2Props>(function X({ initValue, placeholder, multiline, fnsRef, className, onKeyDown, onChangeText }, ref) {
	const [isEnabled, setEnabled] = useState(true)
	const [showFileMenu, setShowFileMenu] = useState(false)
	const [searchText, setSearchText] = useState('')
	const contentRef = useRef<HTMLDivElement | null>(null)

	const adjustHeight = useCallback(() => {
		const r = contentRef.current
		if (!r) return

		r.style.height = 'auto'
		if (r.scrollHeight === 0) return requestAnimationFrame(adjustHeight)
		const h = r.scrollHeight
		const newHeight = Math.min(h + 1, 500)
		r.style.height = `${newHeight}px`
	}, []);

	const fns: TextAreaFns = useMemo(() => ({
		setValue: (val) => {
			const r = contentRef.current
			if (!r) return
			r.textContent = val
			onChangeText?.(r.textContent || '')
			adjustHeight()
		},
		enable: () => { setEnabled(true) },
		disable: () => { setEnabled(false) },
	}), [onChangeText, adjustHeight])

	useEffect(() => {
		if (initValue)
			fns.setValue(initValue)
	}, [initValue])

	const getSerializedContent = (node: HTMLElement): string => {
		console.log('Serializing content from node:', node);
		let result = '';
		node.childNodes.forEach((childNode, index) => {
			console.log(`Processing node ${index}:`, childNode);
			if (childNode.nodeType === Node.TEXT_NODE) {
				console.log('Text node content:', childNode.textContent);
				result += childNode.textContent || '';
			} else if (childNode instanceof Element && childNode.classList.contains('file-reference')) {
				const fileNameSpan = childNode.querySelector('.ml-1');
				console.log('File reference node:', fileNameSpan?.textContent);
				result += '@' + (fileNameSpan?.textContent || '');
			}
		});
		console.log('Final serialized content:', result);
		return result;
	};

	const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
		console.log('handleKeyDown - Key pressed:', e.key, 'showFileMenu:', showFileMenu, 'shift:', e.shiftKey);

		const r = contentRef.current;
		if (!r) {
			console.log('handleKeyDown - No contentRef');
			return;
		}

		// If file menu is open, only handle Escape to close it
		if (showFileMenu) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				setShowFileMenu(false);
			}
			// Let the FilePickerMenu handle all other keys
			return;
		}

		const shouldAddNewline = e.shiftKey && multiline;
		console.log('handleKeyDown - shouldAddNewline:', shouldAddNewline);

		if (e.key === 'Enter' && !shouldAddNewline) {
			console.log('handleKeyDown - Enter pressed, preventing default');
			e.preventDefault();
			e.stopPropagation();

			// Get the content before sending
			const content = Array.from(r.childNodes).map(node => {
				if (node.nodeType === Node.TEXT_NODE) {
					return node.textContent || '';
				} else if (node instanceof Element && node.classList.contains('file-reference')) {
					const fileNameSpan = node.querySelector('.ml-1');
					return '@' + (fileNameSpan?.textContent || '');
				}
				return '';
			}).join('');

			console.log('handleKeyDown - Content to send:', content);

			// Only send if there's actual content
			if (content.trim()) {
				onChangeText?.(content);
			}
		} else if (e.key === '@') {
			console.log('@ key pressed, showing file menu');
			setShowFileMenu(true);
			setSearchText('');
		}

		onKeyDown?.(e);
	}, [onKeyDown, multiline, showFileMenu, onChangeText]);

	const handleChange = useCallback(() => {
		const r = contentRef.current
		if (!r) return

		onChangeText?.(getSerializedContent(r))
		adjustHeight()

		// Handle @ menu search
		const selection = window.getSelection()
		if (!selection) return

		const range = selection.getRangeAt(0)
		const textBeforeCursor = r.textContent?.substring(0, range.startOffset) || ''
		const lastAtPos = textBeforeCursor.lastIndexOf('@')

		// Only show file picker if we're actively typing after an @ symbol
		// and there's no file-reference span between the @ and cursor
		if (lastAtPos !== -1 && lastAtPos < range.startOffset) {
			const cursorNode = range.startContainer;
			const nodes = Array.from(r.childNodes);
			const cursorNodeIndex = nodes.indexOf(cursorNode as ChildNode);

			// Check if we're typing in the same text node as the @ symbol
			// or if we're in a new text node after a file reference
			if (cursorNodeIndex !== -1 &&
				(cursorNode === nodes[0] ||
				 (cursorNode.nodeType === Node.TEXT_NODE &&
				  !nodes.slice(0, cursorNodeIndex)
					  .some(node => node instanceof Element &&
							node.classList.contains('file-reference'))))) {
				const searchStr = textBeforeCursor.substring(lastAtPos + 1)
				setSearchText(searchStr)
				setShowFileMenu(true)
				return
			}
		}

		setShowFileMenu(false)
	}, [onChangeText, adjustHeight])

	const accessor = useAccessor();
	const chatThreadService = accessor.get('IChatThreadService');

	const handleFileSelect = useCallback((selection: StagingSelectionItem) => {
		console.log('File selected:', selection);
		const r = contentRef.current
		if (!r) return

		const sel = window.getSelection()
		if (!sel) return

		const range = sel.getRangeAt(0)
		const textBeforeCursor = r.textContent?.substring(0, range.startOffset) || ''
		const textAfterCursor = r.textContent?.substring(range.startOffset) || ''
		const lastAtPos = textBeforeCursor.lastIndexOf('@')

		console.log('Text before cursor:', textBeforeCursor);
		console.log('Text after cursor:', textAfterCursor);
		console.log('Last @ position:', lastAtPos);

		if (lastAtPos !== -1) {
			const fileName = basename(selection.fileURI);
			console.log('Creating file reference for:', fileName);

			// Create the file reference element
			const fileRefSpan = document.createElement('span');
			fileRefSpan.className = 'file-reference inline-flex items-center bg-void-bg-2 rounded px-1.5 py-0.5 text-void-fg-1 text-sm';

			const atSpan = document.createElement('span');
			atSpan.className = 'text-void-fg-3';
			atSpan.textContent = '@';

			const nameSpan = document.createElement('span');
			nameSpan.className = 'ml-1';
			nameSpan.textContent = fileName;

			fileRefSpan.appendChild(atSpan);
			fileRefSpan.appendChild(nameSpan);

			// Create a new range for the replacement
			const newRange = document.createRange();
			newRange.setStart(r.firstChild || r, lastAtPos);
			newRange.setEnd(range.startContainer, range.startOffset);

			// Delete the @ symbol and any text after it up to cursor
			newRange.deleteContents();

			// Insert the file reference
			newRange.insertNode(fileRefSpan);

			// Add a space after the file reference
			const spaceNode = document.createTextNode(' ');
			fileRefSpan.after(spaceNode);

			// Add back the text that was after the cursor
			if (textAfterCursor) {
				const afterTextNode = document.createTextNode(textAfterCursor);
				spaceNode.after(afterTextNode);
			}

			// Set cursor position after the space
			const selRange = document.createRange();
			selRange.setStartAfter(spaceNode);
			selRange.collapse(true);
			sel.removeAllRanges();
			sel.addRange(selRange);

			// Trigger content update
			const content = getSerializedContent(r);
			console.log('Updated content after file reference:', content);
			onChangeText?.(content);
			adjustHeight();
		}

		// Add the file to staging selections
		const currentStaging = chatThreadService.state.currentStagingSelections ?? [];
		chatThreadService.setStaging([...currentStaging, selection]);

		setShowFileMenu(false);
	}, [onChangeText, adjustHeight, chatThreadService, getSerializedContent]);

	// Add placeholder handling
	useEffect(() => {
		const r = contentRef.current
		if (!r) return

		const updatePlaceholder = () => {
			if (!r.textContent || r.textContent.trim() === '') {
				r.classList.add('empty')
			} else {
				r.classList.remove('empty')
			}
		}

		updatePlaceholder()
		r.addEventListener('input', updatePlaceholder)
		return () => r.removeEventListener('input', updatePlaceholder)
	}, [])

	return (
		<>
			<div
				ref={useCallback((r: HTMLDivElement | null) => {
					if (fnsRef)
						fnsRef.current = fns

					contentRef.current = r
					if (typeof ref === 'function') ref(r)
					else if (ref) ref.current = r
					adjustHeight()
				}, [fnsRef, fns, setEnabled, adjustHeight, ref])}

				contentEditable={isEnabled}
				suppressContentEditableWarning={true}

				className={`w-full min-h-[23px] max-h-[500px] overflow-y-auto text-void-fg-1 outline-none whitespace-pre-wrap
					[&_.file-reference]:inline-flex [&_.file-reference]:items-center [&_.file-reference]:bg-void-bg-2
					[&_.file-reference]:rounded [&_.file-reference]:px-1.5 [&_.file-reference]:py-0.5
					[&_.file-reference]:text-void-fg-1 [&_.file-reference]:text-sm
					empty:before:content-[attr(data-placeholder)] empty:before:text-void-fg-3
					${className}`}
				style={{
					background: asCssVariable(inputBackground),
					color: asCssVariable(inputForeground)
				}}

				onInput={handleChange}
				onKeyDown={handleKeyDown}
				role="textbox"
				aria-multiline={multiline}
				data-placeholder={placeholder}
			/>
			{showFileMenu && (
				<FilePickerMenu
					isOpen={showFileMenu}
					onClose={() => setShowFileMenu(false)}
					onSelect={handleFileSelect}
					anchorEl={contentRef.current}
					searchText={searchText}
				/>
			)}
		</>
	)
})

export const VoidInputBox = ({ onChangeText, onCreateInstance, inputBoxRef, placeholder, multiline }: {
	onChangeText: (value: string) => void;
	styles?: Partial<IInputBoxStyles>,
	onCreateInstance?: (instance: InputBox) => void | IDisposable[];
	inputBoxRef?: { current: InputBox | null };
	placeholder: string;
	multiline: boolean;
}) => {

	const accessor = useAccessor()

	const contextViewProvider = accessor.get('IContextViewService')
	return <WidgetComponent
		ctor={InputBox}
		className='
			bg-void-bg-1
			@@[&_::placeholder]:!void-text-void-fg-3
		'
		propsFn={useCallback((container) => [
			container,
			contextViewProvider,
			{
				inputBoxStyles: {
					...defaultInputBoxStyles,
					inputForeground: "var(--vscode-foreground)",
					// inputBackground: 'transparent',
					// inputBorder: 'none',
				},
				placeholder,
				tooltip: '',
				flexibleHeight: multiline,
				flexibleMaxHeight: 500,
				flexibleWidth: false,
			}
		] as const, [contextViewProvider, placeholder, multiline])}
		dispose={useCallback((instance: InputBox) => {
			instance.dispose()
			instance.element.remove()
		}, [])}
		onCreateInstance={useCallback((instance: InputBox) => {
			const disposables: IDisposable[] = []
			disposables.push(
				instance.onDidChange((newText) => onChangeText(newText))
			)
			if (onCreateInstance) {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (inputBoxRef)
				inputBoxRef.current = instance;

			return disposables
		}, [onChangeText, onCreateInstance, inputBoxRef])
		}
	/>
};




export const VoidSwitch = ({
	value,
	onChange,
	size = 'md',
	label,
	disabled = false,
}: {
	value: boolean;
	onChange: (value: boolean) => void;
	label?: string;
	disabled?: boolean;
	size?: 'xs' | 'sm' | 'sm+' | 'md';
}) => {
	return (
		<label className="inline-flex items-center cursor-pointer">
			<div
				onClick={() => !disabled && onChange(!value)}
				className={`
			relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out
			${value ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'}
			${disabled ? 'opacity-25' : ''}
			${size === 'xs' ? 'h-4 w-7' : ''}
			${size === 'sm' ? 'h-5 w-9' : ''}
			${size === 'sm+' ? 'h-5 w-10' : ''}
			${size === 'md' ? 'h-6 w-11' : ''}
		  `}
			>
				<span
					className={`
			  inline-block transform rounded-full bg-white dark:bg-gray-900 shadow transition-transform duration-200 ease-in-out
			  ${size === 'xs' ? 'h-2.5 w-2.5' : ''}
			  ${size === 'sm' ? 'h-3 w-3' : ''}
			  ${size === 'sm+' ? 'h-3.5 w-3.5' : ''}
			  ${size === 'md' ? 'h-4 w-4' : ''}
			  ${size === 'xs' ? (value ? 'translate-x-3.5' : 'translate-x-0.5') : ''}
			  ${size === 'sm' ? (value ? 'translate-x-5' : 'translate-x-1') : ''}
			  ${size === 'sm+' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			  ${size === 'md' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			`}
				/>
			</div>
			{label && (
				<span className={`
			ml-3 font-medium text-gray-900 dark:text-gray-100
			${size === 'xs' ? 'text-xs' : 'text-sm'}
		  `}>
					{label}
				</span>
			)}
		</label>
	);
};





export const VoidCheckBox = ({ label, value, onClick, className }: { label: string, value: boolean, onClick: (checked: boolean) => void, className?: string }) => {
	const divRef = useRef<HTMLDivElement | null>(null)
	const instanceRef = useRef<Checkbox | null>(null)

	useEffect(() => {
		if (!instanceRef.current) return
		instanceRef.current.checked = value
	}, [value])


	return <WidgetComponent
		className={className ?? ''}
		ctor={Checkbox}
		propsFn={useCallback((container: HTMLDivElement) => {
			divRef.current = container
			return [label, value, defaultCheckboxStyles] as const
		}, [label, value])}
		onCreateInstance={useCallback((instance: Checkbox) => {
			instanceRef.current = instance;
			divRef.current?.append(instance.domNode)
			const d = instance.onChange(() => onClick(instance.checked))
			return [d]
		}, [onClick])}
		dispose={useCallback((instance: Checkbox) => {
			instance.dispose()
			instance.domNode.remove()
		}, [])}

	/>

}



export const VoidCustomDropdownBox = <T extends any>({
	options,
	selectedOption,
	onChangeOption,
	getOptionDropdownName,
	getOptionDisplayName,
	getOptionsEqual,
	className,
	arrowTouchesText = true,
	matchInputWidth = false,
	gap = 0,
}: {
	options: T[];
	selectedOption: T | undefined;
	onChangeOption: (newValue: T) => void;
	getOptionDropdownName: (option: T) => string;
	getOptionDisplayName: (option: T) => string;
	getOptionsEqual: (a: T, b: T) => boolean;
	className?: string;
	arrowTouchesText?: boolean;
	matchInputWidth?: boolean;
	gap?: number;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const measureRef = useRef<HTMLDivElement>(null);

	// Replace manual positioning with floating-ui
	const {
		x,
		y,
		strategy,
		refs,
		middlewareData,
		update
	} = useFloating({
		open: isOpen,
		onOpenChange: setIsOpen,
		placement: 'bottom-start',

		middleware: [
			offset(gap),
			flip({
				boundary: document.body,
				padding: 8
			}),
			shift({
				boundary: document.body,
				padding: 8,
			}),
			size({
				apply({ availableHeight, elements, rects }) {
					const maxHeight = Math.min(availableHeight)

					Object.assign(elements.floating.style, {
						maxHeight: `${maxHeight}px`,
						overflowY: 'auto',
						// Ensure the width isn't constrained by the parent
						width: `${Math.max(
							rects.reference.width,
							measureRef.current?.offsetWidth ?? 0
						)}px`
					});
				},
				padding: 8,
				// Use viewport as boundary instead of any parent element
				boundary: document.body,
			}),
		],
		whileElementsMounted: autoUpdate,
		strategy: 'fixed',
	});

	// if the selected option is null, set the selection to the 0th option
	useEffect(() => {
		if (options.length === 0) return
		if (selectedOption) return
		onChangeOption(options[0])
	}, [selectedOption, onChangeOption, options])

	// Handle clicks outside
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			const floating = refs.floating.current;
			const reference = refs.reference.current;

			// Check if reference is an HTML element before using contains
			const isReferenceHTMLElement = reference && 'contains' in reference;

			if (
				floating &&
				(!isReferenceHTMLElement || !reference.contains(target)) &&
				!floating.contains(target)
			) {
				setIsOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen, refs.floating, refs.reference]);

	if (!selectedOption)
		return null

	return (
		<div className={`inline-block relative ${className}`}>
			{/* Hidden measurement div */}
			<div
				ref={measureRef}
				className="opacity-0 pointer-events-none absolute -left-[999999px] -top-[999999px] flex flex-col"
				aria-hidden="true"
			>
				{options.map((option) => (
					<div key={getOptionDropdownName(option)} className="flex items-center whitespace-nowrap">
						<div className="w-4" />
						<span className="px-2">{getOptionDropdownName(option)}</span>
					</div>
				))}
			</div>

			{/* Select Button */}
			<button
				type='button'
				ref={refs.setReference}
				className="flex items-center h-4 bg-transparent whitespace-nowrap hover:brightness-90 w-full"
				onClick={() => setIsOpen(!isOpen)}
			>
				<span className={`max-w-[120px] truncate ${arrowTouchesText ? 'mr-1' : ''}`}>
					{getOptionDisplayName(selectedOption)}
				</span>
				<svg
					className={`size-3 flex-shrink-0 ${arrowTouchesText ? '' : 'ml-auto'}`}
					viewBox="0 0 12 12"
					fill="none"
				>
					<path
						d="M2.5 4.5L6 8L9.5 4.5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>

			{/* Dropdown Menu */}
			{isOpen && (
				<div
					ref={refs.setFloating}
					className="z-10 bg-void-bg-1 border-void-border-1 border overflow-hidden rounded shadow-lg"
					style={{
						position: strategy,
						top: y ?? 0,
						left: x ?? 0,
						width: matchInputWidth
							? (refs.reference.current instanceof HTMLElement ? refs.reference.current.offsetWidth : 0)
							: Math.max(
								(refs.reference.current instanceof HTMLElement ? refs.reference.current.offsetWidth : 0),
								(measureRef.current instanceof HTMLElement ? measureRef.current.offsetWidth : 0)
							),
					}}
				>
					{options.map((option) => {
						const thisOptionIsSelected = getOptionsEqual(option, selectedOption);
						const optionName = getOptionDropdownName(option);

						return (
							<div
								key={optionName}
								className={`flex items-center px-2 py-1 cursor-pointer whitespace-nowrap
									transition-all duration-100
									bg-void-bg-1
									${thisOptionIsSelected ? 'bg-void-bg-2' : 'hover:bg-void-bg-2'}
								`}
								onClick={() => {
									onChangeOption(option);
									setIsOpen(false);
								}}
							>
								<div className="w-4 flex justify-center flex-shrink-0">
									{thisOptionIsSelected && (
										<svg className="size-3" viewBox="0 0 12 12" fill="none">
											<path
												d="M10 3L4.5 8.5L2 6"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
								</div>
								<span>{optionName}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};



export const _VoidSelectBox = <T,>({ onChangeSelection, onCreateInstance, selectBoxRef, options, className }: {
	onChangeSelection: (value: T) => void;
	onCreateInstance?: ((instance: SelectBox) => void | IDisposable[]);
	selectBoxRef?: React.MutableRefObject<SelectBox | null>;
	options: readonly { text: string, value: T }[];
	className?: string;
}) => {
	const accessor = useAccessor()
	const contextViewProvider = accessor.get('IContextViewService')

	let containerRef = useRef<HTMLDivElement | null>(null);

	return <WidgetComponent
		className={`
			@@select-child-restyle
			@@[&_select]:!void-text-void-fg-3
			@@[&_select]:!void-text-xs
			!text-void-fg-3
			${className ?? ''}
		`}
		ctor={SelectBox}
		propsFn={useCallback((container) => {
			containerRef.current = container
			const defaultIndex = 0;
			return [
				options.map(opt => ({ text: opt.text })),
				defaultIndex,
				contextViewProvider,
				defaultSelectBoxStyles,
			] as const;
		}, [containerRef, options])}

		dispose={useCallback((instance: SelectBox) => {
			instance.dispose();
			containerRef.current?.childNodes.forEach(child => {
				containerRef.current?.removeChild(child)
			})
		}, [containerRef])}

		onCreateInstance={useCallback((instance: SelectBox) => {
			const disposables: IDisposable[] = []

			if (containerRef.current)
				instance.render(containerRef.current)

			disposables.push(
				instance.onDidSelect(e => { onChangeSelection(options[e.index].value); })
			)

			if (onCreateInstance) {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (selectBoxRef)
				selectBoxRef.current = instance;

			return disposables;
		}, [containerRef, onChangeSelection, options, onCreateInstance, selectBoxRef])}

	/>;
};

// makes it so that code in the sidebar isnt too tabbed out
const normalizeIndentation = (code: string): string => {
	const lines = code.split('\n')

	let minLeadingSpaces = Infinity

	// find the minimum number of leading spaces
	for (const line of lines) {
		if (line.trim() === '') continue;
		let leadingSpaces = 0;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '\t' || char === ' ') {
				leadingSpaces += 1;
			} else { break; }
		}
		minLeadingSpaces = Math.min(minLeadingSpaces, leadingSpaces)
	}

	// remove the leading spaces
	return lines.map(line => {
		if (line.trim() === '') return line;

		let spacesToRemove = minLeadingSpaces;
		let i = 0;
		while (spacesToRemove > 0 && i < line.length) {
			const char = line[i];
			if (char === '\t' || char === ' ') {
				spacesToRemove -= 1;
				i++;
			} else { break; }
		}

		return line.slice(i);

	}).join('\n')

}


const modelOfEditorId: { [id: string]: ITextModel | undefined } = {}
export type VoidCodeEditorProps = { initValue: string, language?: string, maxHeight?: number, showScrollbars?: boolean }
export const VoidCodeEditor = ({ initValue, language, maxHeight, showScrollbars }: VoidCodeEditorProps) => {

	initValue = normalizeIndentation(initValue)

	// default settings
	const MAX_HEIGHT = maxHeight ?? Infinity;
	const SHOW_SCROLLBARS = showScrollbars ?? false;

	const divRef = useRef<HTMLDivElement | null>(null)

	const accessor = useAccessor()
	const instantiationService = accessor.get('IInstantiationService')
	// const languageDetectionService = accessor.get('ILanguageDetectionService')
	const modelService = accessor.get('IModelService')


	const id = useId()

	// these are used to pass to the model creation of modelRef
	const initValueRef = useRef(initValue)
	const languageRef = useRef(language)

	const modelRef = useRef<ITextModel | null>(null)

	// if we change the initial value, don't re-render the whole thing, just set it here. same for language
	useEffect(() => {
		initValueRef.current = initValue
		modelRef.current?.setValue(initValue)
	}, [initValue])
	useEffect(() => {
		languageRef.current = language
		if (language) modelRef.current?.setLanguage(language)
	}, [language])

	return <div ref={divRef} className='relative z-0 px-2 py-1 bg-void-bg-3'>
		<WidgetComponent
			className='@@bg-editor-style-override' // text-sm
			ctor={useCallback((container) => {
				return instantiationService.createInstance(
					CodeEditorWidget,
					container,
					{
						automaticLayout: true,
						wordWrap: 'off',

						scrollbar: {
							alwaysConsumeMouseWheel: false,
							...SHOW_SCROLLBARS ? {
								vertical: 'auto',
								verticalScrollbarSize: 8,
								horizontal: 'auto',
								horizontalScrollbarSize: 8,
							} : {
								vertical: 'hidden',
								verticalScrollbarSize: 0,
								horizontal: 'auto',
								horizontalScrollbarSize: 8,
								ignoreHorizontalScrollbarInContentHeight: true,

							},
						},
						scrollBeyondLastLine: false,

						lineNumbers: 'off',

						readOnly: true,
						domReadOnly: true,
						readOnlyMessage: { value: '' },

						minimap: {
							enabled: false,
							// maxColumn: 0,
						},

						hover: { enabled: false },

						selectionHighlight: false, // highlights whole words
						renderLineHighlight: 'none',

						folding: false,
						lineDecorationsWidth: 0,
						overviewRulerLanes: 0,
						hideCursorInOverviewRuler: true,
						overviewRulerBorder: false,
						glyphMargin: false,

						stickyScroll: {
							enabled: false,
						},
					},
					{
						isSimpleWidget: true,
					})
			}, [instantiationService])}

			onCreateInstance={useCallback((editor: CodeEditorWidget) => {
				const model = modelOfEditorId[id] ?? modelService.createModel(
					initValueRef.current, {
					languageId: languageRef.current ? languageRef.current : 'typescript',
					onDidChange: (e) => { return { dispose: () => { } } } // no idea why they'd require this
				})
				modelRef.current = model
				editor.setModel(model);

				const container = editor.getDomNode()
				const parentNode = container?.parentElement
				const resize = () => {
					const height = editor.getScrollHeight() + 1
					if (parentNode) {
						// const height = Math.min(, MAX_HEIGHT);
						parentNode.style.height = `${height}px`;
						parentNode.style.maxHeight = `${MAX_HEIGHT}px`;
						editor.layout();
					}
				}

				resize()
				const disposable = editor.onDidContentSizeChange(() => { resize() });

				return [disposable, model]
			}, [modelService])}

			dispose={useCallback((editor: CodeEditorWidget) => {
				editor.dispose();
			}, [modelService])}

			propsFn={useCallback(() => { return [] }, [])}
		/>
	</div>

}


export const VoidButton = ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) => {
	return <button disabled={disabled}
		className='px-3 py-1 bg-black/10 dark:bg-gray-200/10 rounded-sm overflow-hidden'
		onClick={onClick}
	>{children}</button>
}

// export const VoidScrollableElt = ({ options, children }: { options: ScrollableElementCreationOptions, children: React.ReactNode }) => {
// 	const instanceRef = useRef<DomScrollableElement | null>(null);
// 	const [childrenPortal, setChildrenPortal] = useState<React.ReactNode | null>(null)

// 	return <>
// 		<WidgetComponent
// 			ctor={DomScrollableElement}
// 			propsFn={useCallback((container) => {
// 				return [container, options] as const;
// 			}, [options])}
// 			onCreateInstance={useCallback((instance: DomScrollableElement) => {
// 				instanceRef.current = instance;
// 				setChildrenPortal(createPortal(children, instance.getDomNode()))
// 				return []
// 			}, [setChildrenPortal, children])}
// 			dispose={useCallback((instance: DomScrollableElement) => {
// 				console.log('calling dispose!!!!')
// 				// instance.dispose();
// 				// instance.getDomNode().remove()
// 			}, [])}
// 		>{children}</WidgetComponent>

// 		{childrenPortal}

// 	</>
// }

// export const VoidSelectBox = <T,>({ onChangeSelection, initVal, selectBoxRef, options }: {
// 	initVal: T;
// 	selectBoxRef: React.MutableRefObject<SelectBox | null>;
// 	options: readonly { text: string, value: T }[];
// 	onChangeSelection: (value: T) => void;
// }) => {


// 	return <WidgetComponent
// 		ctor={DropdownMenu}
// 		propsFn={useCallback((container) => {
// 			return [
// 				container, {
// 					contextMenuProvider,
// 					actions: options.map(({ text, value }, i) => ({
// 						id: i + '',
// 						label: text,
// 						tooltip: text,
// 						class: undefined,
// 						enabled: true,
// 						run: () => {
// 							onChangeSelection(value);
// 						},
// 					}))

// 				}] as const;
// 		}, [options, initVal, contextViewProvider])}

// 		dispose={useCallback((instance: DropdownMenu) => {
// 			instance.dispose();
// 			// instance.element.remove()
// 		}, [])}

// 		onCreateInstance={useCallback((instance: DropdownMenu) => {
// 			return []
// 		}, [])}

// 	/>;
// };




// export const VoidCheckBox = ({ onChangeChecked, initVal, label, checkboxRef, }: {
// 	onChangeChecked: (checked: boolean) => void;
// 	initVal: boolean;
// 	checkboxRef: React.MutableRefObject<ObjectSettingCheckboxWidget | null>;
// 	label: string;
// }) => {
// 	const containerRef = useRef<HTMLDivElement>(null);


// 	useEffect(() => {
// 		if (!containerRef.current) return;

// 		// Create and mount the Checkbox using VSCode's implementation

// 		checkboxRef.current = new ObjectSettingCheckboxWidget(
// 			containerRef.current,
// 			themeService,
// 			contextViewService,
// 			hoverService,
// 		);


// 		checkboxRef.current.setValue([{
// 			key: { type: 'string', data: label },
// 			value: { type: 'boolean', data: initVal },
// 			removable: false,
// 			resetable: true,
// 		}])

// 		checkboxRef.current.onDidChangeList((list) => {
// 			onChangeChecked(!!list);
// 		})


// 		// cleanup
// 		return () => {
// 			if (checkboxRef.current) {
// 				checkboxRef.current.dispose();
// 				if (containerRef.current) {
// 					while (containerRef.current.firstChild) {
// 						containerRef.current.removeChild(containerRef.current.firstChild);
// 					}
// 				}
// 				checkboxRef.current = null;
// 			}
// 		};
// 	}, [checkboxRef, label, initVal, onChangeChecked]);

// 	return <div ref={containerRef} className="w-full" />;
// };

const FileReference = ({ fileName }: { fileName: string }) => {
	return (
		<span className="inline-flex items-center bg-void-bg-2 rounded px-1.5 py-0.5 text-void-fg-1 text-sm">
			<span className="text-void-fg-3">@</span>
			<span className="ml-1">{fileName}</span>
		</span>
	);
};


// 						containerRef.current.removeChild(containerRef.current.firstChild);
// 					}
// 				}
// 				checkboxRef.current = null;
// 			}
// 		};
// 	}, [checkboxRef, label, initVal, onChangeChecked]);

// 	return <div ref={containerRef} className="w-full" />;
// };



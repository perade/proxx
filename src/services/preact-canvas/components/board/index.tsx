/**
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Component, h } from "preact";
import { StateChange } from "src/gamelogic/index.js";
import { Animator } from "src/rendering/animator.js";
import { Renderer } from "src/rendering/renderer.js";
import { putCanvas } from "src/utils/canvas-pool.js";
import { cellFocusMode } from "src/utils/constants.js";
import { isFeaturePhone } from "src/utils/static-display.js";
import { Cell } from "../../../../gamelogic/types.js";
import { bind } from "../../../../utils/bind.js";
import { GameChangeCallback } from "../../index.js";
import {
  board,
  button as buttonStyle,
  canvas as canvasStyle,
  container as containerStyle,
  gameCell,
  gameRow,
  gameTable
} from "./style.css";

const defaultCell: Cell = {
  flagged: false,
  hasMine: false,
  revealed: false,
  touchingFlags: 0,
  touchingMines: 0
};

export interface Props {
  onCellClick: (cell: [number, number, Cell], alt: boolean) => void;
  width: number;
  height: number;
  renderer: Renderer;
  animator: Animator;
  dangerMode: boolean;
  gameChangeSubscribe: (f: GameChangeCallback) => void;
  gameChangeUnsubscribe: (f: GameChangeCallback) => void;
}

interface State {
  keyNavigation: boolean;
}

export default class Board extends Component<Props, State> {
  state: State = {
    keyNavigation: false
  };

  private _canvas?: HTMLCanvasElement;
  private _table?: HTMLTableElement;
  private _buttons: HTMLButtonElement[] = [];
  private _firstCellRect?: ClientRect | DOMRect;
  private _additionalButtonData = new WeakMap<
    HTMLButtonElement,
    [number, number, Cell]
  >();
  private _currentTabableBtn?: HTMLButtonElement;

  componentDidMount() {
    document.documentElement.classList.add("in-game");
    this._createTable(this.props.width, this.props.height);
    this.props.gameChangeSubscribe(this._doManualDomHandling);
    this._rendererInit();
    this._queryFirstCellRect();
    this.props.renderer.updateFirstRect(this._firstCellRect!);

    // If the intro was scrolled to the bottom, we need to move it back up again. The nebula
    // overflows the viewport on devices that hide the URL bar on scroll.
    window.scrollTo(0, 0);

    // Center scroll position
    const scroller = this.base!.querySelector(
      "." + containerStyle
    ) as HTMLElement;
    scroller.scrollLeft = scroller.scrollWidth / 2 - scroller.offsetWidth / 2;
    scroller.scrollTop = scroller.scrollHeight / 2 - scroller.offsetHeight / 2;

    window.addEventListener("resize", this._onWindowResize);
    window.addEventListener("keyup", this._onKeyUp);
  }

  componentWillUnmount() {
    document.documentElement.classList.remove("in-game");
    window.removeEventListener("resize", this._onWindowResize);
    window.removeEventListener("keyup", this._onKeyUp);
    this.props.gameChangeUnsubscribe(this._doManualDomHandling);
    this.props.renderer.stop();
    this.props.animator.stop();
    putCanvas(this._canvas!);
  }

  shouldComponentUpdate() {
    return false;
  }

  render() {
    return (
      <div class={board}>
        <div class={containerStyle} onScroll={this._onTableScroll} />
      </div>
    );
  }

  @bind
  private _onWindowResize() {
    this._onTableScroll();
    this.props.renderer.onResize();
  }

  @bind
  private _onTableScroll() {
    this._queryFirstCellRect();
    this.props.renderer.updateFirstRect(this._firstCellRect!);
  }

  @bind
  private _onKeyUp(event: KeyboardEvent) {
    if (
      (isFeaturePhone || cellFocusMode) &&
      (event.key === "9" ||
        event.key === "7" ||
        event.key === "5" ||
        event.key === "0")
    ) {
      this.moveFocusByKey(event, 0, 0);
    }
  }

  @bind
  private _doManualDomHandling(stateChange: StateChange) {
    if (!stateChange.gridChanges) {
      return;
    }

    // Update DOM straight away
    for (const [x, y, cell] of stateChange.gridChanges) {
      const btn = this._buttons[y * this.props.width + x];
      this._updateButton(btn, cell, x, y);
    }
    this.props.animator.updateCells(stateChange.gridChanges);
  }

  private _createTable(width: number, height: number) {
    const tableContainer = document.querySelector("." + containerStyle);
    this._table = document.createElement("table");
    this._table.classList.add(gameTable);
    this._table.setAttribute("role", "grid");
    this._table.setAttribute("aria-label", "The game grid");
    for (let row = 0; row < height; row++) {
      const tr = document.createElement("tr");
      tr.setAttribute("role", "row");
      tr.classList.add(gameRow);
      for (let col = 0; col < width; col++) {
        const y = row;
        const x = col;
        const td = document.createElement("td");
        td.setAttribute("role", "gridcell");
        td.classList.add(gameCell);
        const button = document.createElement("button");
        button.classList.add(buttonStyle);

        // set only 1st cell tab focusable
        if (row === 0 && col === 0) {
          button.setAttribute("tabindex", "0");
          this._currentTabableBtn = button;
        } else {
          button.setAttribute("tabindex", "-1");
        }
        button.addEventListener("blur", this.removeFocusVisual);
        this._additionalButtonData.set(button, [x, y, defaultCell]);
        this._updateButton(button, defaultCell, x, y);
        this._buttons.push(button);
        td.appendChild(button);
        tr.appendChild(td);
      }
      this._table.appendChild(tr);
    }
    this._canvas = this.props.renderer.createCanvas();
    this._canvas.classList.add(canvasStyle);
    this.base!.appendChild(this._canvas);
    tableContainer!.appendChild(this._table);
    this._table.addEventListener("keydown", this.onKeyDownOnTable);
    this._table.addEventListener("keyup", this.onKeyUpOnTable);
    this._table.addEventListener("mouseup", this.onMouseUp);
    this._table.addEventListener("mousedown", this.onMouseDown);
    this._table.addEventListener("contextmenu", event =>
      event.preventDefault()
    );
    // On feature phone, show focus visual on mouse hover as well
    // Have to be mousemove on table, instead of mouseenter on buttons to avoid
    // unwanted focus move on scroll.
    if (isFeaturePhone || cellFocusMode) {
      this._table.addEventListener("mousemove", this.moveFocusWithMouse);
    }
  }

  private _rendererInit() {
    this.props.renderer.init(this.props.width, this.props.height);
  }

  private _queryFirstCellRect() {
    this._firstCellRect = this._buttons[0]
      .closest("td")!
      .getBoundingClientRect();
  }

  @bind
  private removeFocusVisual() {
    this.props.renderer.setFocus(-1, -1);
  }

  @bind
  private setFocusVisual(button: HTMLButtonElement) {
    const [x, y] = this._additionalButtonData.get(button)!;
    this.props.renderer.setFocus(x, y);
  }

  @bind
  private setFocus(newFocusBtn: HTMLButtonElement) {
    // move tab index to targetBtn (necessary for roving tabindex)
    this._currentTabableBtn!.setAttribute("tabIndex", "-1");
    newFocusBtn.setAttribute("tabIndex", "0");
    this._currentTabableBtn = newFocusBtn;

    newFocusBtn.focus();
    this.setFocusVisual(newFocusBtn);
  }

  @bind
  private moveFocusWithMouse(event: MouseEvent) {
    // Find if the mouse is on one of the button
    const targetBtn = event.target as HTMLButtonElement;
    const targetIsBtn = this._additionalButtonData.has(targetBtn);
    if (!targetIsBtn) {
      // the mouse is not on a button
      this.removeFocusVisual();
      return;
    }

    // Locate button that currently have focus
    const activeBtn = document.activeElement as HTMLButtonElement;
    const activeIsBtn = this._additionalButtonData.has(activeBtn);
    if (activeIsBtn && activeBtn !== targetBtn) {
      // If different button has focus, blur the button.
      activeBtn.blur();
    }
    this.setFocus(targetBtn);
  }

  @bind
  private moveFocusByKey(event: KeyboardEvent, h: number, v: number) {
    event.stopPropagation();

    // Find which button has focus
    const currentBtn = document.activeElement as HTMLButtonElement;
    let btnInfo = this._additionalButtonData.get(currentBtn);

    // If no button has focus, key navigation must have came back to the table.
    // Focus back on tabindex=0 button first.
    if (!btnInfo) {
      this._currentTabableBtn!.focus();
      btnInfo = this._additionalButtonData.get(this._currentTabableBtn!)!;
    }

    const x = btnInfo[0];
    const y = btnInfo[1];
    const width = this.props.width;
    const height = this.props.height;

    // move x, y position by passed steps h:horizontal, v:vertical
    const newX = x + h;
    const newY = y + v;

    // Check if [newX, newY] position is out of the game field.
    if (newX < 0 || newX >= width || (newY < 0 || newY >= height)) {
      return;
    }

    const nextIndex = newX + newY * width;
    const nextBtn = this._buttons[nextIndex];
    this.setFocus(nextBtn);
  }

  @bind
  private onKeyUpOnTable(event: KeyboardEvent) {
    if (event.key === "Tab") {
      this.moveFocusByKey(event, 0, 0);
    }
  }

  @bind
  private onKeyDownOnTable(event: KeyboardEvent) {
    // Since click action is tied to mouseup event,
    // listen to Enter in case of key navigation click.
    // Key 8 support is for T9 navigation
    if (event.key === "Enter" || event.key === "8") {
      const button = document.activeElement as HTMLButtonElement;
      if (!button) {
        return;
      }
      event.preventDefault();
      this.simulateClick(button);
    } else if (event.key === "ArrowRight" || event.key === "9") {
      this.moveFocusByKey(event, 1, 0);
    } else if (event.key === "ArrowLeft" || event.key === "7") {
      this.moveFocusByKey(event, -1, 0);
    } else if (event.key === "ArrowUp" || event.key === "5") {
      this.moveFocusByKey(event, 0, -1);
    } else if (event.key === "ArrowDown" || event.key === "0") {
      this.moveFocusByKey(event, 0, 1);
    }
  }

  // Stopping event is necessary for preventing click event on KaiOS
  // which moves focus to the mouse and end up clicking two cells,
  // one under the mouse and one that is currently focused
  @bind
  private onMouseUp(event: MouseEvent) {
    // hit test if the mouse up was on a button if not, cancel.
    let targetButton = event.target as HTMLButtonElement;
    const targetButtonData = this._additionalButtonData.get(targetButton);
    if (!targetButtonData) {
      return;
    }

    event.preventDefault();

    if (isFeaturePhone || cellFocusMode) {
      // find currently focused element.
      const activeButton = document.activeElement as HTMLButtonElement;
      const isActiveBtn = this._additionalButtonData.has(activeButton);
      if (!isActiveBtn) {
        // no other butten has focus, so it's safe to focus on mouse
        this.setFocus(targetButton);
      } else {
        // If active button exists, then that button should be clicked.
        // This is needed for feature phone.
        targetButton = activeButton;
      }
    }

    if (event.button !== 2) {
      // normal click
      this.simulateClick(targetButton);
      return;
    }
    // right (two finger) click
    this.simulateClick(targetButton, true);
  }

  // Same as mouseup, necessary for preventing click event on KaiOS
  @bind
  private onMouseDown(event: MouseEvent) {
    event.preventDefault();
  }

  @bind
  private simulateClick(button: HTMLButtonElement, alt = false) {
    const buttonData = this._additionalButtonData.get(button)!;
    this.props.onCellClick(buttonData, alt);
  }

  private _updateButton(
    btn: HTMLButtonElement,
    cell: Cell,
    x: number,
    y: number
  ) {
    let cellState;
    if (!cell.revealed) {
      cellState = cell.flagged ? `flag` : `hidden`;
    } else if (cell.hasMine) {
      cellState = `black hole`;
    } else if (cell.touchingMines === 0) {
      cellState = `blank`;
    } else {
      cellState = `${cell.touchingMines}`;
    }

    btn.setAttribute("aria-label", cellState);
    this._additionalButtonData.get(btn)![2] = cell;
  }
}

import { mount } from "svelte";
import "./styles.css";
import Help from "./Help.svelte";
import { disableContextMenu } from "./lib/contextmenu";

disableContextMenu();

export default mount(Help, { target: document.getElementById("app")! });
import { mount } from "svelte";
import "./styles.css";
import QuickAdd from "./QuickAdd.svelte";
import { disableContextMenu } from "./lib/contextmenu";

disableContextMenu();

export default mount(QuickAdd, { target: document.getElementById("app")! });

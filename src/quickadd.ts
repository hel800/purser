import { mount } from "svelte";
import "./styles.css";
import QuickAdd from "./QuickAdd.svelte";

export default mount(QuickAdd, { target: document.getElementById("app")! });

package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	parser "github.com/wreulicke/classfile-parser"
)

// ---------------------------------------------------------------------------
// Output types (serialized to JSON for the JS side)
// ---------------------------------------------------------------------------

type ClassInfo struct {
	MajorVersion int          `json:"majorVersion"`
	MinorVersion int          `json:"minorVersion"`
	JavaVersion  string       `json:"javaVersion"`
	AccessFlags  []string     `json:"accessFlags"`
	ClassName    string       `json:"className"`
	SuperClass   string       `json:"superClass"`
	Interfaces   []string     `json:"interfaces"`
	SourceFile   string       `json:"sourceFile,omitempty"`
	Fields       []FieldInfo  `json:"fields"`
	Methods      []MethodInfo `json:"methods"`
	IsDeprecated bool         `json:"isDeprecated,omitempty"`
	Signature    string       `json:"signature,omitempty"`
}

type FieldInfo struct {
	AccessFlags []string `json:"accessFlags"`
	Name        string   `json:"name"`
	Descriptor  string   `json:"descriptor"`
	TypeName    string   `json:"typeName"`
	Signature   string   `json:"signature,omitempty"`
}

type MethodInfo struct {
	AccessFlags []string `json:"accessFlags"`
	Name        string   `json:"name"`
	Descriptor  string   `json:"descriptor"`
	ReturnType  string   `json:"returnType"`
	ParamTypes  []string `json:"paramTypes"`
	Exceptions  []string `json:"exceptions,omitempty"`
	Signature   string   `json:"signature,omitempty"`
	Bytecode    string   `json:"bytecode,omitempty"`
	MaxStack    int      `json:"maxStack,omitempty"`
	MaxLocals   int      `json:"maxLocals,omitempty"`
}

// ---------------------------------------------------------------------------
// Java version mapping
// ---------------------------------------------------------------------------

var majorVersionMap = map[int]string{
	45: "1.1", 46: "1.2", 47: "1.3", 48: "1.4",
	49: "5", 50: "6", 51: "7", 52: "8",
	53: "9", 54: "10", 55: "11", 56: "12",
	57: "13", 58: "14", 59: "15", 60: "16",
	61: "17", 62: "18", 63: "19", 64: "20",
	65: "21", 66: "22", 67: "23", 68: "24",
}

// ---------------------------------------------------------------------------
// Access flag helpers
// ---------------------------------------------------------------------------

func classAccessFlags(flags parser.AccessFlags) []string {
	result := make([]string, 0)
	if flags.Is(parser.ACC_PUBLIC) {
		result = append(result, "public")
	}
	if flags.Is(parser.ACC_FINAL) {
		result = append(result, "final")
	}
	if flags.Is(parser.ACC_SUPER) {
		// ACC_SUPER is set by modern compilers but not a source-level modifier
	}
	if flags.Is(parser.ACC_ABSTRACT) {
		result = append(result, "abstract")
	}
	if flags.Is(parser.ACC_SYNTHETIC) {
		result = append(result, "synthetic")
	}
	if flags.Is(parser.ACC_ANNOTATION) {
		result = append(result, "annotation")
	}
	if flags.Is(parser.ACC_ENUM) {
		result = append(result, "enum")
	}
	if flags.Is(parser.ACC_MODULE) && !flags.Is(parser.ACC_SUPER) {
		result = append(result, "module")
	}
	// Determine class kind
	if flags.Is(parser.ACC_ANNOTATION) {
		// already added
	} else if flags.Is(parser.ACC_ENUM) {
		// already added
	} else if flags.Is(0x0200) { // ACC_INTERFACE
		result = append(result, "interface")
	} else {
		result = append(result, "class")
	}
	return result
}

func fieldAccessFlags(flags parser.AccessFlags) []string {
	result := make([]string, 0)
	if flags.Is(parser.ACC_PUBLIC) {
		result = append(result, "public")
	}
	if flags.Is(parser.ACC_PRIVATE) {
		result = append(result, "private")
	}
	if flags.Is(parser.ACC_PROTECTED) {
		result = append(result, "protected")
	}
	if flags.Is(parser.ACC_STATIC) {
		result = append(result, "static")
	}
	if flags.Is(parser.ACC_FINAL) {
		result = append(result, "final")
	}
	if flags.Is(parser.ACC_VOLATILE) {
		result = append(result, "volatile")
	}
	if flags.Is(parser.ACC_TRANSIENT) {
		result = append(result, "transient")
	}
	if flags.Is(parser.ACC_SYNTHETIC) {
		result = append(result, "synthetic")
	}
	if flags.Is(parser.ACC_ENUM) {
		result = append(result, "enum")
	}
	return result
}

func methodAccessFlags(flags parser.AccessFlags) []string {
	result := make([]string, 0)
	if flags.Is(parser.ACC_PUBLIC) {
		result = append(result, "public")
	}
	if flags.Is(parser.ACC_PRIVATE) {
		result = append(result, "private")
	}
	if flags.Is(parser.ACC_PROTECTED) {
		result = append(result, "protected")
	}
	if flags.Is(parser.ACC_STATIC) {
		result = append(result, "static")
	}
	if flags.Is(parser.ACC_FINAL) {
		result = append(result, "final")
	}
	if flags.Is(parser.ACC_SYNCHRONIZED) {
		result = append(result, "synchronized")
	}
	if flags.Is(parser.ACC_BRIDGE) {
		result = append(result, "bridge")
	}
	if flags.Is(parser.ACC_VARARGS) {
		result = append(result, "varargs")
	}
	if flags.Is(parser.ACC_NATIVE) {
		result = append(result, "native")
	}
	if flags.Is(parser.ACC_ABSTRACT) {
		result = append(result, "abstract")
	}
	if flags.Is(parser.ACC_STRICT) {
		result = append(result, "strictfp")
	}
	if flags.Is(parser.ACC_SYNTHETIC) {
		result = append(result, "synthetic")
	}
	return result
}

// ---------------------------------------------------------------------------
// Descriptor parsing (JVM type descriptors -> human-readable Java types)
// ---------------------------------------------------------------------------

func parseDescriptorType(desc string, pos *int) string {
	if *pos >= len(desc) {
		return "?"
	}
	ch := desc[*pos]
	*pos++
	switch ch {
	case 'B':
		return "byte"
	case 'C':
		return "char"
	case 'D':
		return "double"
	case 'F':
		return "float"
	case 'I':
		return "int"
	case 'J':
		return "long"
	case 'S':
		return "short"
	case 'Z':
		return "boolean"
	case 'V':
		return "void"
	case '[':
		elemType := parseDescriptorType(desc, pos)
		return elemType + "[]"
	case 'L':
		end := strings.IndexByte(desc[*pos:], ';')
		if end == -1 {
			return "?"
		}
		className := desc[*pos : *pos+end]
		*pos += end + 1
		// Convert internal name (java/lang/String) to dot notation
		return strings.ReplaceAll(className, "/", ".")
	default:
		return string(ch)
	}
}

func parseFieldDescriptor(desc string) string {
	pos := 0
	return parseDescriptorType(desc, &pos)
}

func parseMethodDescriptor(desc string) ([]string, string) {
	if len(desc) == 0 || desc[0] != '(' {
		return []string{}, "?"
	}
	pos := 1 // skip '('
	params := make([]string, 0)
	for pos < len(desc) && desc[pos] != ')' {
		params = append(params, parseDescriptorType(desc, &pos))
	}
	if pos < len(desc) {
		pos++ // skip ')'
	}
	retType := parseDescriptorType(desc, &pos)
	return params, retType
}

// ---------------------------------------------------------------------------
// Bytecode disassembler (self-contained, does not depend on library internals)
// ---------------------------------------------------------------------------

// Opcode names indexed by opcode byte value
var opcodeNames = [256]string{
	0: "nop", 1: "aconst_null", 2: "iconst_m1", 3: "iconst_0",
	4: "iconst_1", 5: "iconst_2", 6: "iconst_3", 7: "iconst_4",
	8: "iconst_5", 9: "lconst_0", 10: "lconst_1", 11: "fconst_0",
	12: "fconst_1", 13: "fconst_2", 14: "dconst_0", 15: "dconst_1",
	16: "bipush", 17: "sipush", 18: "ldc", 19: "ldc_w",
	20: "ldc2_w", 21: "iload", 22: "lload", 23: "fload",
	24: "dload", 25: "aload", 26: "iload_0", 27: "iload_1",
	28: "iload_2", 29: "iload_3", 30: "lload_0", 31: "lload_1",
	32: "lload_2", 33: "lload_3", 34: "fload_0", 35: "fload_1",
	36: "fload_2", 37: "fload_3", 38: "dload_0", 39: "dload_1",
	40: "dload_2", 41: "dload_3", 42: "aload_0", 43: "aload_1",
	44: "aload_2", 45: "aload_3", 46: "iaload", 47: "laload",
	48: "faload", 49: "daload", 50: "aaload", 51: "baload",
	52: "caload", 53: "saload", 54: "istore", 55: "lstore",
	56: "fstore", 57: "dstore", 58: "astore", 59: "istore_0",
	60: "istore_1", 61: "istore_2", 62: "istore_3", 63: "lstore_0",
	64: "lstore_1", 65: "lstore_2", 66: "lstore_3", 67: "fstore_0",
	68: "fstore_1", 69: "fstore_2", 70: "fstore_3", 71: "dstore_0",
	72: "dstore_1", 73: "dstore_2", 74: "dstore_3", 75: "astore_0",
	76: "astore_1", 77: "astore_2", 78: "astore_3", 79: "iastore",
	80: "lastore", 81: "fastore", 82: "dastore", 83: "aastore",
	84: "bastore", 85: "castore", 86: "sastore", 87: "pop",
	88: "pop2", 89: "dup", 90: "dup_x1", 91: "dup_x2",
	92: "dup2", 93: "dup2_x1", 94: "dup2_x2", 95: "swap",
	96: "iadd", 97: "ladd", 98: "fadd", 99: "dadd",
	100: "isub", 101: "lsub", 102: "fsub", 103: "dsub",
	104: "imul", 105: "lmul", 106: "fmul", 107: "dmul",
	108: "idiv", 109: "ldiv", 110: "fdiv", 111: "ddiv",
	112: "irem", 113: "lrem", 114: "frem", 115: "drem",
	116: "ineg", 117: "lneg", 118: "fneg", 119: "dneg",
	120: "ishl", 121: "lshl", 122: "ishr", 123: "lshr",
	124: "iushr", 125: "lushr", 126: "iand", 127: "land",
	128: "ior", 129: "lor", 130: "ixor", 131: "lxor",
	132: "iinc", 133: "i2l", 134: "i2f", 135: "i2d",
	136: "l2i", 137: "l2f", 138: "l2d", 139: "f2i",
	140: "f2l", 141: "f2d", 142: "d2i", 143: "d2l",
	144: "d2f", 145: "i2b", 146: "i2c", 147: "i2s",
	148: "lcmp", 149: "fcmpl", 150: "fcmpg", 151: "dcmpl",
	152: "dcmpg", 153: "ifeq", 154: "ifne", 155: "iflt",
	156: "ifge", 157: "ifgt", 158: "ifle", 159: "if_icmpeq",
	160: "if_icmpne", 161: "if_icmplt", 162: "if_icmpge",
	163: "if_icmpgt", 164: "if_icmple", 165: "if_acmpeq",
	166: "if_acmpne", 167: "goto", 168: "jsr", 169: "ret",
	170: "tableswitch", 171: "lookupswitch", 172: "ireturn",
	173: "lreturn", 174: "freturn", 175: "dreturn", 176: "areturn",
	177: "return", 178: "getstatic", 179: "putstatic",
	180: "getfield", 181: "putfield", 182: "invokevirtual",
	183: "invokespecial", 184: "invokestatic", 185: "invokeinterface",
	186: "invokedynamic", 187: "new", 188: "newarray",
	189: "anewarray", 190: "arraylength", 191: "athrow",
	192: "checkcast", 193: "instanceof", 194: "monitorenter",
	195: "monitorexit", 196: "wide", 197: "multianewarray",
	198: "ifnull", 199: "ifnonnull", 200: "goto_w", 201: "jsr_w",
}

// resolveConstantRef resolves a constant pool index to a human-readable string
func resolveConstantRef(cp *parser.ConstantPool, index uint16) string {
	if int(index) < 1 || int(index) > len(cp.Constants) {
		return fmt.Sprintf("#%d", index)
	}
	c := cp.Constants[index-1]
	if c == nil {
		return fmt.Sprintf("#%d", index)
	}

	switch v := c.(type) {
	case *parser.ConstantClass:
		name := cp.LookupUtf8(v.NameIndex)
		if name != nil {
			return strings.ReplaceAll(name.String(), "/", ".")
		}
	case *parser.ConstantString:
		s := cp.LookupUtf8(v.StringIndex)
		if s != nil {
			str := s.String()
			if len(str) > 40 {
				str = str[:37] + "..."
			}
			return fmt.Sprintf("\"%s\"", str)
		}
	case *parser.ConstantFieldref:
		return resolveRef(cp, v.ClassIndex, v.NameAndTypeIndex)
	case *parser.ConstantMethodref:
		return resolveRef(cp, v.ClassIndex, v.NameAndTypeIndex)
	case *parser.ConstantInterfaceMethodref:
		return resolveRef(cp, v.ClassIndex, v.NameAndTypeIndex)
	case *parser.ConstantNameAndType:
		name := cp.LookupUtf8(v.NameIndex)
		desc := cp.LookupUtf8(v.DescriptorIndex)
		if name != nil && desc != nil {
			return name.String() + ":" + desc.String()
		}
	case *parser.ConstantInteger:
		return fmt.Sprintf("%d", int32(v.Bytes))
	case *parser.ConstantFloat:
		return fmt.Sprintf("%f", float32(v.Bytes))
	case *parser.ConstantLong:
		val := int64(v.HighBytes)<<32 | int64(v.LowBytes)
		return fmt.Sprintf("%dL", val)
	case *parser.ConstantUtf8:
		return v.String()
	case *parser.ConstantInvokeDynamic:
		nat := resolveConstantRef(cp, v.NameAndTypeIndex)
		return fmt.Sprintf("InvokeDynamic #%d:%s", v.BootstrapMethodAttrIndex, nat)
	}
	return fmt.Sprintf("#%d", index)
}

func resolveRef(cp *parser.ConstantPool, classIndex, natIndex uint16) string {
	className, err := cp.GetClassName(classIndex)
	if err != nil {
		className = fmt.Sprintf("#%d", classIndex)
	} else {
		className = strings.ReplaceAll(className, "/", ".")
	}

	natConst := cp.Constants[natIndex-1]
	nat, ok := natConst.(*parser.ConstantNameAndType)
	if !ok {
		return className + ".#" + fmt.Sprintf("%d", natIndex)
	}
	name := cp.LookupUtf8(nat.NameIndex)
	desc := cp.LookupUtf8(nat.DescriptorIndex)
	if name != nil && desc != nil {
		return className + "." + name.String() + ":" + desc.String()
	}
	return className + ".?"
}

// disassemble converts raw bytecode bytes into javap-like text output
func disassemble(code []byte, cp *parser.ConstantPool) string {
	var sb strings.Builder
	i := 0
	for i < len(code) {
		op := code[i]
		name := opcodeNames[op]
		if name == "" {
			name = fmt.Sprintf("0x%02x", op)
		}

		switch op {
		// No operands
		case 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
			26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
			40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53,
			59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72,
			73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86,
			87, 88, 89, 90, 91, 92, 93, 94, 95,
			96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107,
			108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
			120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131,
			133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144,
			145, 146, 147, 148, 149, 150, 151, 152,
			172, 173, 174, 175, 176, 177, 190, 191, 194, 195:
			fmt.Fprintf(&sb, "%4d: %s\n", i, name)
			i++

		// 1-byte operand (local variable index or byte value)
		case 16, 21, 22, 23, 24, 25, 54, 55, 56, 57, 58, 169, 188: // bipush, ?load, ?store, ret, newarray
			if i+1 < len(code) {
				fmt.Fprintf(&sb, "%4d: %-16s %d\n", i, name, int8(code[i+1]))
			} else {
				fmt.Fprintf(&sb, "%4d: %s\n", i, name)
			}
			i += 2

		// ldc (1-byte CP index)
		case 18:
			if i+1 < len(code) {
				idx := uint16(code[i+1])
				ref := resolveConstantRef(cp, idx)
				fmt.Fprintf(&sb, "%4d: %-16s #%d // %s\n", i, name, idx, ref)
			}
			i += 2

		// 2-byte operand: CP index (ldc_w, ldc2_w, getstatic, putstatic, getfield, putfield,
		// invokevirtual, invokespecial, invokestatic, new, anewarray, checkcast, instanceof)
		case 19, 20, 178, 179, 180, 181, 182, 183, 184, 187, 189, 192, 193:
			if i+2 < len(code) {
				idx := binary.BigEndian.Uint16(code[i+1 : i+3])
				ref := resolveConstantRef(cp, idx)
				fmt.Fprintf(&sb, "%4d: %-16s #%d // %s\n", i, name, idx, ref)
			}
			i += 3

		// 2-byte signed branch offset
		case 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164,
			165, 166, 167, 168, 198, 199: // if*, goto, jsr, ifnull, ifnonnull
			if i+2 < len(code) {
				offset := int16(binary.BigEndian.Uint16(code[i+1 : i+3]))
				target := i + int(offset)
				fmt.Fprintf(&sb, "%4d: %-16s %d\n", i, name, target)
			}
			i += 3

		// sipush: 2-byte signed value
		case 17:
			if i+2 < len(code) {
				val := int16(binary.BigEndian.Uint16(code[i+1 : i+3]))
				fmt.Fprintf(&sb, "%4d: %-16s %d\n", i, name, val)
			}
			i += 3

		// iinc: 2 single-byte operands
		case 132:
			if i+2 < len(code) {
				fmt.Fprintf(&sb, "%4d: %-16s %d, %d\n", i, name, code[i+1], int8(code[i+2]))
			}
			i += 3

		// invokeinterface: 2-byte CP index + count + 0
		case 185:
			if i+4 < len(code) {
				idx := binary.BigEndian.Uint16(code[i+1 : i+3])
				ref := resolveConstantRef(cp, idx)
				fmt.Fprintf(&sb, "%4d: %-16s #%d, %d // %s\n", i, name, idx, code[i+3], ref)
			}
			i += 5

		// invokedynamic: 2-byte CP index + 0 + 0
		case 186:
			if i+4 < len(code) {
				idx := binary.BigEndian.Uint16(code[i+1 : i+3])
				ref := resolveConstantRef(cp, idx)
				fmt.Fprintf(&sb, "%4d: %-16s #%d // %s\n", i, name, idx, ref)
			}
			i += 5

		// multianewarray: 2-byte CP index + 1-byte dimensions
		case 197:
			if i+3 < len(code) {
				idx := binary.BigEndian.Uint16(code[i+1 : i+3])
				ref := resolveConstantRef(cp, idx)
				fmt.Fprintf(&sb, "%4d: %-16s #%d, %d // %s\n", i, name, idx, code[i+3], ref)
			}
			i += 4

		// goto_w, jsr_w: 4-byte signed branch offset
		case 200, 201:
			if i+4 < len(code) {
				offset := int32(binary.BigEndian.Uint32(code[i+1 : i+5]))
				target := i + int(offset)
				fmt.Fprintf(&sb, "%4d: %-16s %d\n", i, name, target)
			}
			i += 5

		// tableswitch: variable length
		case 170:
			fmt.Fprintf(&sb, "%4d: tableswitch { // ...\n", i)
			i++
			// skip padding to 4-byte alignment
			for i%4 != 0 {
				i++
			}
			if i+12 <= len(code) {
				defaultOff := int32(binary.BigEndian.Uint32(code[i : i+4]))
				low := int32(binary.BigEndian.Uint32(code[i+4 : i+8]))
				high := int32(binary.BigEndian.Uint32(code[i+8 : i+12]))
				i += 12
				for j := low; j <= high && i+4 <= len(code); j++ {
					off := int32(binary.BigEndian.Uint32(code[i : i+4]))
					fmt.Fprintf(&sb, "%12d: %d\n", j, int(off)+i-12-1)
					i += 4
				}
				fmt.Fprintf(&sb, "     default: %d\n", int(defaultOff)+i-12-1)
			}
			sb.WriteString("      }\n")

		// lookupswitch: variable length
		case 171:
			basePC := i
			fmt.Fprintf(&sb, "%4d: lookupswitch { // ...\n", i)
			i++
			for i%4 != 0 {
				i++
			}
			if i+8 <= len(code) {
				defaultOff := int32(binary.BigEndian.Uint32(code[i : i+4]))
				npairs := int32(binary.BigEndian.Uint32(code[i+4 : i+8]))
				i += 8
				for j := int32(0); j < npairs && i+8 <= len(code); j++ {
					matchVal := int32(binary.BigEndian.Uint32(code[i : i+4]))
					off := int32(binary.BigEndian.Uint32(code[i+4 : i+8]))
					fmt.Fprintf(&sb, "%12d: %d\n", matchVal, basePC+int(off))
					i += 8
				}
				fmt.Fprintf(&sb, "     default: %d\n", basePC+int(defaultOff))
			}
			sb.WriteString("      }\n")

		// wide: prefix for wider operands
		case 196:
			if i+1 < len(code) {
				wideOp := code[i+1]
				wideName := opcodeNames[wideOp]
				if wideName == "" {
					wideName = fmt.Sprintf("0x%02x", wideOp)
				}
				if wideOp == 132 { // wide iinc
					if i+5 < len(code) {
						idx := binary.BigEndian.Uint16(code[i+2 : i+4])
						val := int16(binary.BigEndian.Uint16(code[i+4 : i+6]))
						fmt.Fprintf(&sb, "%4d: wide %-12s %d, %d\n", i, wideName, idx, val)
					}
					i += 6
				} else {
					if i+3 < len(code) {
						idx := binary.BigEndian.Uint16(code[i+2 : i+4])
						fmt.Fprintf(&sb, "%4d: wide %-12s %d\n", i, wideName, idx)
					}
					i += 4
				}
			} else {
				fmt.Fprintf(&sb, "%4d: wide\n", i)
				i += 2
			}

		default:
			fmt.Fprintf(&sb, "%4d: 0x%02x (unknown)\n", i, op)
			i++
		}
	}
	return sb.String()
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

func parseClassFile(data []byte) (*ClassInfo, error) {
	p := parser.New(bytes.NewReader(data))
	cf, err := p.Parse()
	if err != nil {
		return nil, fmt.Errorf("failed to parse class file: %w", err)
	}

	cp := cf.ConstantPool

	// Class name
	className, err := cf.ThisClassName()
	if err != nil {
		className = "?"
	}
	className = strings.ReplaceAll(className, "/", ".")

	// Super class
	superClass := ""
	if cf.SuperClass != 0 {
		sc, err := cf.SuperClassName()
		if err == nil {
			superClass = strings.ReplaceAll(sc, "/", ".")
		}
	}

	// Interfaces (must be non-nil so JSON encodes as [] not null)
	interfaces := make([]string, 0)
	for _, idx := range cf.Interfaces {
		iName, err := cp.GetClassName(idx)
		if err == nil {
			interfaces = append(interfaces, strings.ReplaceAll(iName, "/", "."))
		}
	}

	// Java version
	javaVersion := majorVersionMap[int(cf.MajorVersion)]
	if javaVersion == "" {
		javaVersion = fmt.Sprintf("unknown (%d)", cf.MajorVersion)
	}

	// Source file
	sourceFile := ""
	if sf := cf.SourceFile(); sf != nil {
		if utf8 := cp.LookupUtf8(sf.SourcefileIndex); utf8 != nil {
			sourceFile = utf8.String()
		}
	}

	// Signature
	signature := ""
	if sig := cf.Signature(); sig != nil {
		if utf8 := cp.LookupUtf8(sig.Signature); utf8 != nil {
			signature = utf8.String()
		}
	}

	// Fields
	fields := make([]FieldInfo, 0, len(cf.Fields))
	for _, f := range cf.Fields {
		name, _ := f.Name(cp)
		desc, _ := f.Descriptor(cp)
		fi := FieldInfo{
			AccessFlags: fieldAccessFlags(f.AccessFlags),
			Name:        name,
			Descriptor:  desc,
			TypeName:    parseFieldDescriptor(desc),
		}
		if sig := f.Signature(); sig != nil {
			if utf8 := cp.LookupUtf8(sig.Signature); utf8 != nil {
				fi.Signature = utf8.String()
			}
		}
		fields = append(fields, fi)
	}

	// Methods
	methods := make([]MethodInfo, 0, len(cf.Methods))
	for _, m := range cf.Methods {
		name, _ := m.Name(cp)
		desc, _ := m.Descriptor(cp)
		paramTypes, retType := parseMethodDescriptor(desc)

		mi := MethodInfo{
			AccessFlags: methodAccessFlags(m.AccessFlags),
			Name:        name,
			Descriptor:  desc,
			ReturnType:  retType,
			ParamTypes:  paramTypes,
		}

		// Exceptions
		if exc := m.Exceptions(); exc != nil {
			for _, idx := range exc.ExceptionIndexes {
				eName, err := cp.GetClassName(idx)
				if err == nil {
					mi.Exceptions = append(mi.Exceptions, strings.ReplaceAll(eName, "/", "."))
				}
			}
		}

		// Signature
		if sig := m.Signature(); sig != nil {
			if utf8 := cp.LookupUtf8(sig.Signature); utf8 != nil {
				mi.Signature = utf8.String()
			}
		}

		// Bytecode disassembly
		if codeAttr := m.Code(); codeAttr != nil {
			mi.MaxStack = int(codeAttr.MaxStack)
			mi.MaxLocals = int(codeAttr.MaxLocals)
			mi.Bytecode = disassemble(codeAttr.Codes, cp)
		}

		methods = append(methods, mi)
	}

	return &ClassInfo{
		MajorVersion: int(cf.MajorVersion),
		MinorVersion: int(cf.MinorVersion),
		JavaVersion:  javaVersion,
		AccessFlags:  classAccessFlags(cf.AccessFlags),
		ClassName:    className,
		SuperClass:   superClass,
		Interfaces:   interfaces,
		SourceFile:   sourceFile,
		Fields:       fields,
		Methods:      methods,
		IsDeprecated: cf.Deprecated() != nil,
		Signature:    signature,
	}, nil
}

// ---------------------------------------------------------------------------
// JS exports
// ---------------------------------------------------------------------------

func jsError(msg string) any {
	return js.Global().Get("Promise").Call("reject",
		js.Global().Get("Error").New(msg))
}

func main() {
	// __wasm_parseClass(Uint8Array) -> Promise<string>
	// Parse a Java .class file from raw bytes.
	// Returns JSON ClassInfo.
	js.Global().Set("__wasm_parseClass", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return jsError("parseClass requires exactly 1 argument (Uint8Array)")
		}

		handler := js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			reject := promise[1]

			go func() {
				jsArr := args[0]
				length := jsArr.Get("length").Int()

				data := make([]byte, length)
				js.CopyBytesToGo(data, jsArr)

				result, err := parseClassFile(data)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to parse class file: " + err.Error()))
					return
				}

				jsonBytes, err := json.Marshal(result)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to serialize result: " + err.Error()))
					return
				}

				resolve.Invoke(string(jsonBytes))
			}()

			return nil
		})

		return js.Global().Get("Promise").New(handler)
	}))

	// Block forever — WASM instance must stay alive to serve calls.
	select {}
}

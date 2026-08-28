import javax.swing.*;
import javax.swing.border.*;
import java.awt.*;
import java.awt.event.*;

public class PremiumCalculator extends JFrame {
    private JTextField display;
    private StringBuilder expression = new StringBuilder();
    private boolean newNumber = true;

    public PremiumCalculator() {
        setTitle("Premium Calculator");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(500, 600);
        setLocationRelativeTo(null);
        setResizable(false);
        
        // Premium color scheme
        Color bgColor = new Color(30, 30, 40);
        Color buttonColor = new Color(50, 50, 70);
        Color accentColor = new Color(100, 200, 255);
        Color textColor = new Color(240, 240, 245);
        
        JPanel mainPanel = new JPanel();
        mainPanel.setBackground(bgColor);
        mainPanel.setLayout(new BorderLayout(15, 15));
        mainPanel.setBorder(new EmptyBorder(20, 20, 20, 20));
        
        // Display
        display = new JTextField();
        display.setFont(new Font("Segoe UI", Font.PLAIN, 36));
        display.setBackground(new Color(40, 40, 55));
        display.setForeground(accentColor);
        display.setCaretColor(accentColor);
        display.setBorder(new LineBorder(accentColor, 2));
        display.setEditable(false);
        display.setText("0");
        display.setHorizontalAlignment(JTextField.RIGHT);
        mainPanel.add(display, BorderLayout.NORTH);
        
        // Button panel
        JPanel buttonPanel = new JPanel();
        buttonPanel.setBackground(bgColor);
        buttonPanel.setLayout(new GridLayout(5, 4, 10, 10));
        
        String[] buttons = {
            "C", "DEL", "%", "÷",
            "7", "8", "9", "×",
            "4", "5", "6", "−",
            "1", "2", "3", "+",
            "0", ".", "=", "√"
        };
        
        for (String btn : buttons) {
            JButton button = createStyledButton(btn, buttonColor, textColor, accentColor);
            button.addActionListener(e -> handleButtonClick(btn));
            buttonPanel.add(button);
        }
        
        mainPanel.add(buttonPanel, BorderLayout.CENTER);
        add(mainPanel);
        setVisible(true);
    }
    
    private JButton createStyledButton(String text, Color bgColor, Color fgColor, Color accentColor) {
        JButton button = new JButton(text);
        button.setFont(new Font("Segoe UI", Font.BOLD, 18));
        button.setBackground(bgColor);
        button.setForeground(fgColor);
        button.setBorder(new LineBorder(accentColor, 1));
        button.setFocusPainted(false);
        button.setCursor(new Cursor(Cursor.HAND_CURSOR));
        
        button.addMouseListener(new MouseAdapter() {
            public void mouseEntered(MouseEvent e) {
                button.setBackground(new Color(70, 70, 95));
            }
            public void mouseExited(MouseEvent e) {
                button.setBackground(bgColor);
            }
        });
        
        return button;
    }
    
    private void handleButtonClick(String cmd) {
        switch (cmd) {
            case "C":
                expression.setLength(0);
                display.setText("0");
                newNumber = true;
                break;
            case "DEL":
                if (expression.length() > 0) {
                    expression.deleteCharAt(expression.length() - 1);
                    display.setText(expression.toString().isEmpty() ? "0" : expression.toString());
                }
                break;
            case "=":
                try {
                    double result = evaluate(expression.toString());
                    display.setText(String.valueOf(result));
                    expression.setLength(0);
                    expression.append(result);
                    newNumber = true;
                } catch (Exception ex) {
                    display.setText("Error");
                }
                break;
            case "√":
                try {
                    double value = Double.parseDouble(expression.toString());
                    double result = Math.sqrt(value);
                    expression.setLength(0);
                    expression.append(result);
                    display.setText(String.valueOf(result));
                    newNumber = true;
                } catch (Exception ex) {
                    display.setText("Error");
                }
                break;
            case "÷":
                appendOperator("/");
                break;
            case "×":
                appendOperator("*");
                break;
            case "−":
                appendOperator("-");
                break;
            case "+":
                appendOperator("+");
                break;
            case "%":
                appendOperator("%");
                break;
            default:
                if (newNumber && !cmd.equals(".")) {
                    expression.setLength(0);
                    newNumber = false;
                }
                expression.append(cmd);
                display.setText(expression.toString());
        }
    }
    
    private void appendOperator(String op) {
        if (expression.length() > 0 && !expression.toString().endsWith("+") && 
            !expression.toString().endsWith("-") && !expression.toString().endsWith("*") && 
            !expression.toString().endsWith("/") && !expression.toString().endsWith("%")) {
            expression.append(op);
            display.setText(expression.toString());
            newNumber = true;
        }
    }
    
    private double evaluate(String expr) {
        expr = expr.replace("÷", "/").replace("×", "*").replace("−", "-");
        return (double) new javax.script.ScriptEngineManager()
            .getEngineByName("JavaScript")
            .eval(expr);
    }
    
    public static void main(String[] args) {
        SwingUtilities.invokeLater(PremiumCalculator::new);
    }
}
